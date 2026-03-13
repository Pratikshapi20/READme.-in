  
require('dotenv').config();

const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const path = require("path");
const bcrypt = require("bcrypt");
const multer = require("multer");

const User = require("./models/user");
const Contact = require("./models/contact");
const Message = require("./models/Message");
const Report = require("./models/report");
const translateText = require("./utils/translateText");
const authRoutes = require("./routes/auth");

const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Run on port 3000
const port = 3000;

const userSockets = new Map();


const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/password";

mongoose.connect(MONGODB_URI)
  .then(() => console.log(" MongoDB Connected"))
  .catch((err) => console.log(" MongoDB Error:", err));

app.set("view engine", "ejs");
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));
app.use(session({
  secret: process.env.SESSION_SECRET || "your-secret-key",
  resave: false,
  saveUninitialized: true
}));

//  Languages
const languageList = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "mr", name: "Marathi" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese (Simplified)" },
  { code: "ar", name: "Arabic" },
  { code: "bn", name: "Bengali" },
  { code: "pa", name: "Punjabi" },
  { code: "te", name: "Telugu" },
  { code: "ta", name: "Tamil" },
  { code: "gu", name: "Gujarati" },
  { code: "ur", name: "Urdu" },
  { code: "tr", name: "Turkish" },
  { code: "nl", name: "Dutch" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "no", name: "Norwegian" },
  { code: "fi", name: "Finnish" },
  { code: "pl", name: "Polish" },
  { code: "cs", name: "Czech" },
  { code: "hu", name: "Hungarian" },
  { code: "ro", name: "Romanian" },
  { code: "bg", name: "Bulgarian" },
  { code: "el", name: "Greek" },
  { code: "he", name: "Hebrew" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "fil", name: "Filipino" },
  { code: "sw", name: "Swahili" },
  { code: "am", name: "Amharic" },
  { code: "ha", name: "Hausa" },
  { code: "yo", name: "Yoruba" }
];


io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.on("register", (userId) => {
    userSockets.set(userId, socket.id);
  });
  socket.on("disconnect", () => {
    for (let [userId, socketId] of userSockets) {
      if (socketId === socket.id) {
        userSockets.delete(userId);
        break;
      }
    }
  });
  socket.on("send_message", (data) => {
    io.to(data.receiverId).emit("receive_message", data);
  });
  socket.on("join_room", (roomId) => socket.join(roomId));
});

//  Routes
app.use(authRoutes);

app.get("/", (req, res) => {
  res.render("index", { languages: languageList });
});
app.get("/login", (req, res) => {
  const error = req.session.error;
  delete req.session.error;
  res.render("login", { error });
});

app.get("/register", (req, res) => res.render("index"));

app.post("/create", async (req, res) => {
  const { username, email, password, language } = req.body;
  const exists = await User.findOne({ $or: [{ email }, { username }] });
  if (exists) return res.status(400).send("User exists");
  await User.create({ username, email, password, language });
  res.redirect("/login");
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).send("Invalid credentials");
  }
  if (user.isDeleted) {
    req.session.error = `${user.username} your account deleted from LTC App`;
    return res.redirect("/login");
  }
  req.session.user = {
    _id: user._id,
    name: user.username,
    email: user.email,
    about: user.about,
    profilePicture: user.profilePicUrl || null,
    language: user.language || null
  };
  res.cookie("userId", user._id.toString(), { maxAge: 86400000 });
  res.cookie("lang", user.language || "en", { maxAge: 86400000 });

  // If user hasn't set language, redirect to language selection
  if (!user.language) {
    return res.redirect("/language");
  }

  res.redirect("/chat");
});

app.get("/admin-login", (req, res) => res.render("admin-login"));

app.post("/admin-login", (req, res) => {
  const { email, password } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL || "sachinraut@gmail.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "1331";
  if (email === adminEmail && password === adminPassword) {
    req.session.user = {
      _id: "admin",
      name: "Admin",
      email: adminEmail,
      isAdmin: true
    };
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.send("Session error");
      }
      res.redirect("/users");
    });
  } else {
    res.send("Invalid user");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.clearCookie("userId");
  res.clearCookie("lang");
  res.redirect("/login");
});

app.get("/language", (req, res) => {
  res.render("language", { languages: languageList });
});

app.post("/set-language", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.isAdmin) return res.redirect("/users");
  const userId = req.session.user._id;
  const language = req.body.language;
  await User.findByIdAndUpdate(userId, { language });
  req.session.user.language = language;
  res.cookie("lang", language, { maxAge: 86400000 });
  res.redirect("/chat");
});

app.get("/app", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.isAdmin) return res.redirect("/users");
  const lang = req.cookies.lang || "en";
  let message = "Welcome to the chat interface!";
  try {
    message = await translateText(message, lang);
  } catch (err) {
    console.error("Translation error:", err);
  }
  res.render("home", { user: req.session.user, message });
});


const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "./public/uploads/"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/\s+/g, '_');
    cb(null, `${Date.now()}-${name}${ext}`);
  }
});
const upload = multer({ storage });

app.get("/edit-profile", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.isAdmin) return res.redirect("/users");
  const user = await User.findById(req.session.user._id);
  if (!user) return res.redirect("/login");
  res.render("edit-profile", { user, languages: languageList });
});

app.post("/edit-profile", upload.single("profilePicture"), async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.isAdmin) return res.redirect("/users");
  const { about, language } = req.body;
  const updateData = { about, language };
  console.log("Uploaded file:", req.file);
  if (req.file) {
    updateData.profilePicUrl = "/uploads/" + req.file.filename;
    console.log("New profile pic URL:", updateData.profilePicUrl);
  }
  const updatedUser = await User.findByIdAndUpdate(req.session.user._id, updateData, { new: true });
  console.log("Updated user profilePicUrl:", updatedUser.profilePicUrl);
  req.session.user = {
    _id: updatedUser._id,
    name: updatedUser.username,
    email: updatedUser.email,
    about: updatedUser.about,
    profilePicture: updatedUser.profilePicUrl || null,
    language: updatedUser.language || 'en'
  };
  console.log("Session profilePicture:", req.session.user.profilePicture);
  res.redirect("/app");
});

app.get('/contacts', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.isAdmin) return res.redirect('/users');
  res.render('contacts', { user: req.session.user });
});

app.get("/users", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const currentUser = req.session.user.isAdmin ? null : await User.findById(req.session.user._id);
  const allUsers = req.session.user.isAdmin ? await User.find() : await User.find({ _id: { $ne: req.session.user._id }, isDeleted: false });
  const usersWithBlockStatus = allUsers.map(user => ({
    ...user.toObject(),
    isBlocked: currentUser?.blockedUsers?.includes(user._id.toString()) || false
  }));

  let reports = [];
  if (req.session.user.isAdmin) {
    reports = await Report.find({ reporterId: { $type: 7 }, reportedUserId: { $type: 7 } }).populate('reporterId', 'username').populate('reportedUserId', 'username isDeleted');
  }

  res.render("users", { user: req.session.user, users: usersWithBlockStatus, reports });
});

app.get("/new-chat", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.isAdmin) return res.redirect("/users");
  const currentUser = await User.findById(req.session.user._id);
  const allUsers = await User.find({ _id: { $ne: req.session.user._id } });
  const usersWithBlockStatus = allUsers.map(user => ({
    ...user.toObject(),
    isBlocked: currentUser.blockedUsers && currentUser.blockedUsers.includes(user._id.toString())
  }));
  res.render("new-chat", { users: usersWithBlockStatus });
});

app.post("/chat/start", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.isAdmin) return res.status(403).send("Admins cannot send messages");
  const senderId = req.session.user._id;
  const { recipientId, message } = req.body;
  if (!recipientId || !message) return res.status(400).send("Recipient and message are required.");
  const newMessage = new Message({
    from: senderId,
    to: recipientId,
    originalText: message,
    translatedText: "",
    timestamp: new Date()
  });
  await newMessage.save();
  res.redirect("/chat/" + recipientId);
});

//  Chat List
app.get("/chat", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.isAdmin) return res.redirect("/users");
  const userId = req.session.user._id;

  // Fetch messages involving current user
  const messages = await Message.find({
    $or: [{ from: userId }, { to: userId }]
  }).sort({ createdAt: -1 });

  const contactIds = new Set();
  const recentMap = new Map();

  for (let msg of messages) {
    const contactId = msg.from.toString() === userId.toString() ? msg.to.toString() : msg.from.toString();
    if (!contactIds.has(contactId)) {
      contactIds.add(contactId);
      recentMap.set(contactId, {
        userId: contactId,
        lastMessage: msg.message || msg.originalText || msg.translatedText || "No content",
        lastMessageTime: msg.timestamp
          ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : ""
      });
    }
  }

  // Fetch users who have chatted with current user
  const contacts = await User.find({ _id: { $in: Array.from(contactIds) } });

  // Map contacts to include last message info and block status
  const finalList = contacts.map(user => {
    const lastMsgData = recentMap.get(user._id.toString());
    return {
      _id: user._id,
      username: user.username,
      lastMessage: lastMsgData ? lastMsgData.lastMessage : null,
      lastMessageTime: lastMsgData ? lastMsgData.lastMessageTime : null,
      isBlocked: req.session.user.blockedUsers && req.session.user.blockedUsers.includes(user._id.toString())
    };
  });

  // Sort: users with lastMessageTime first (desc), then others by username
  finalList.sort((a, b) => {
    if (a.lastMessageTime && b.lastMessageTime) {
      return b.lastMessageTime.localeCompare(a.lastMessageTime);
    } else if (a.lastMessageTime) {
      return -1;
    } else if (b.lastMessageTime) {
      return 1;
    } else {
      return a.username.localeCompare(b.username);
    }
  });

  // Show language modal if user has not set language yet
  const showLanguageModal = !(req.session.user && req.session.user.language);

  // If user has not set language, redirect to language selection page instead of chat list
  if (showLanguageModal) {
    return res.redirect("/language");
  }

  res.render("chat-list", {
    contacts: finalList,
    user: req.session.user || {},
    showLanguageModal: false,
    languages: languageList
  });
});
//  Replace your existing /chat/:contactId route with this
app.get("/chat/:contactId", async (req, res) => {
  const userId = req.session.user?._id;
  const contactId = req.params.contactId;
  if (!userId) return res.redirect("/login");
  if (req.session.user.isAdmin) return res.redirect("/users");
  const contact = await User.findById(contactId);
  if (!contact) return res.redirect("/chat");

  const currentUser = await User.findById(userId);
  const userLanguage = currentUser.language || "en";

  const messages = await Message.find({
    $or: [
      { from: userId, to: contactId },
      { from: contactId, to: userId }
    ]
  }).sort({ createdAt: 1 });

  const formattedMessages = await Promise.all(messages.map(async (msg) => {
    const isSender = msg.from.toString() === userId.toString();
    let displayText = msg.originalText;

    // Translate message to current user's language if different from original
    try {
      displayText = await translateText(msg.originalText, userLanguage);
    } catch (err) {
      console.error("Translation error:", err);
      displayText = msg.originalText; // Fallback to original
    }

    return {
      senderName: isSender ? "You" : contact.username,
      message: displayText
    };
  }));

  res.render("chat-room", {
    user: req.session.user,
    contactId,
    contactName: contact.username,
    contactProfilePicture: contact.profilePicUrl || null,
    contactAbout: contact.about,
    messages: formattedMessages
  });
});

//  Replace your existing /send-message/:to route with this
app.post("/send-message/:to", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.user.isAdmin) return res.status(403).json({ error: "Admins cannot send messages" });
  const fromId = req.session.user._id;
  const toId = req.params.to;
  const { message } = req.body;

  const fromUser = await User.findById(fromId);
  const toUser = await User.findById(toId);



  // Store the original message without translation
  const newMessage = await Message.create({
    from: fromId,
    to: toId,
    originalText: message,
    translatedText: message, // Store same as original for now
    timestamp: new Date()
  });

  const roomId = [fromId, toId].sort().join("_");
  io.to(roomId).emit("receive_message", {
    senderId: fromId.toString(),
    senderName: fromUser.name || fromUser.username,
    message: message, // Send original message
    messageId: newMessage._id.toString() // Send message ID to prevent duplicates
  });

  res.status(200).json({ success: true });
});


app.get("/calls", (req, res) => res.render("calls", { calls: [] }));
app.get("/call/:contactId", (req, res) => res.send(`📞 Call feature coming soon for ${req.params.contactId}`));

app.post("/add-contact", async (req, res) => {
  const { name, phone } = req.body;
  const userId = req.cookies.userId;
  if (!userId) return res.redirect("/login");
  if (req.session.user.isAdmin) return res.redirect("/users");
  await Contact.create({ userId, name, phone });
  res.redirect("/contacts");
});



app.get("/generate-pdf/:contactId", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.isAdmin) return res.redirect("/users");
  const userId = req.session.user._id;
  const contactId = req.params.contactId;
  console.log("Generating PDF for contactId:", contactId, "userId:", userId);
  const contact = await User.findById(contactId);
  if (!contact) return res.redirect("/chat");

  const currentUser = await User.findById(userId);
  const userLanguage = currentUser.language || "en";
  console.log("User language:", userLanguage);

  const messages = await Message.find({
    $or: [
      { from: userId, to: contactId },
      { from: contactId, to: userId }
    ]
  }).sort({ createdAt: 1 });
  console.log("Found messages:", messages.length);


  let title = `Chat with ${contact.username}`;
  try {
    title = await translateText(title, userLanguage);
  } catch (err) {
    console.log('Title translation failed');
  }

  const translatedMessages = await Promise.all(messages.map(async (msg) => {
    let displayText = msg.originalText;
    console.log(`Translating message: "${msg.originalText}" to ${userLanguage}`);
    try {
      displayText = await translateText(msg.originalText, userLanguage);
      console.log(`Translated to: "${displayText}"`);
    } catch (err) {
      console.error("Translation error for PDF:", err);
      // Fallback to original text
    }
    let sender = msg.from.toString() === userId.toString() ? 'You' : contact.username;
    try {
      if (sender === 'You') {
        sender = await translateText(sender, userLanguage);
      }
    } catch (err) {
      console.log('Sender translation failed');
    }
    return {
      sender,
      text: displayText
    };
  }));

  const PDFDocument = require('pdfkit');
  const fontkit = require('fontkit');
  const doc = new PDFDocument({ font: 'NotoSansDevanagari' });
  try {
    doc.registerFont('NotoSansDevanagari', fontkit.openSync(path.join(__dirname, 'public', 'fonts', 'NotoSansDevanagari-Regular.ttf')));
    doc.font('NotoSansDevanagari');
  } catch (err) {
    console.log('Font not loaded, using default');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="chat-with-${contact.username.replace(/\s+/g, '_')}.pdf"`);

  doc.pipe(res);
  doc.fontSize(20).text(title, 100, 100);
  doc.moveDown();

  translatedMessages.forEach(msg => {
    doc.font('NotoSansDevanagari').fontSize(12).text(`${msg.sender}: ${msg.text}`);
    doc.moveDown(0.5);
  });

  doc.end();
});

app.get("/allusers", async (req, res) => {
  const users = await User.find();
  res.send(users);
});

// Translation endpoint for client-side translation
app.post("/translate", async (req, res) => {
  const { text, targetLang } = req.body;
  console.log(`Translating client-side: "${text}" to ${targetLang}`);
  try {
    const translatedText = await translateText(text, targetLang);
    console.log(`Translated to: "${translatedText}"`);
    res.json({ translatedText });
  } catch (err) {
    console.error("Translation error:", err);
    res.status(500).json({ error: "Translation failed" });
  }
});

// Report user endpoint
app.post("/report", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.session.user.isAdmin) return res.status(403).json({ error: "Admins cannot report users" });
  const { reportedUserId, reason, description } = req.body;
  const reporterId = req.session.user._id;

  if (!reportedUserId || !reason) return res.status(400).json({ error: "Reported user and reason are required" });

  try {
    // Fetch reported user to get username
    const reportedUser = await User.findById(reportedUserId);
    if (!reportedUser) return res.status(404).json({ error: "Reported user not found" });

    const report = new Report({
      reporterId,
      reportedUserId,
      reportedUserName: reportedUser.username,
      reason,
      description
    });
    await report.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Error saving report:", err);
    res.status(500).json({ error: "Failed to submit report" });
  }
});

// Delete user by admin
app.delete("/delete-user/:userId", async (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) return res.status(403).json({ error: "Unauthorized" });
  const { userId } = req.params;

  try {
    await User.findByIdAndDelete(userId);
    if (userSockets.has(userId)) {
      io.to(userSockets.get(userId)).emit('force_logout');
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting user:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});


server.listen(3000, () => {
  console.log(`🚀 Server running at http://localhost:${3000}}`);
});

