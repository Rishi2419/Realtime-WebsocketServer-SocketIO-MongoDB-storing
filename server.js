const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: "*", // Allow any origin
    methods: ["GET", "POST"]
  }
});

// MongoDB Connection
mongoose.connect("mongodb://localhost:27017/anonymous_chat", {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("MongoDB connected successfully");
}).catch(err => {
  console.error("MongoDB connection error:", err);
});

// Message Schema
const messageSchema = new mongoose.Schema({
  text: String,
  senderId: String,
  room: String,
  timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// User Schema - stores persistent user IDs
const userSchema = new mongoose.Schema({
  deviceId: String, // Unique device identifier
  userId: String,    // Persistent user ID for chat
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

app.get("/", (req, res) => {
  res.send("Server is running");
});

// Keep track of active users
const activeUsers = new Map();

io.on("connection", (socket) => {
  console.log("New client connected: " + socket.id);

  socket.on("registerUser", async ({ deviceId }) => {
    try {
      // Check if user exists with this device ID
      let user = await User.findOne({ deviceId });
      
      if (!user) {
        // Create a new user with persistent ID
        const newUserId = "user_" + Math.random().toString(36).substring(2, 8);
        user = new User({
          deviceId,
          userId: newUserId
        });
        await user.save();
        console.log(`New user registered with ID: ${newUserId}`);
      }
      
      // Send the persistent userId back to the client
      socket.emit("userRegistered", { userId: user.userId });
      console.log(`User registered: ${user.userId} for device: ${deviceId}`);
    } catch (err) {
      console.error("Error registering user:", err);
      socket.emit("error", { message: "Failed to register user" });
    }
  });

  socket.on("joinRoom", async ({ senderId, receiverId }) => {
    // For global chat, everyone joins the same room
    if (receiverId === "global_chat_room") {
      socket.join("global_chat_room");
      console.log(`User ${senderId} joined global chat room`);
      
      // Store user info
      activeUsers.set(senderId, {
        socketId: socket.id,
        inRoom: "global_chat_room"
      });
      
      // Fetch and send chat history
      try {
        const messageHistory = await Message.find({ room: "global_chat_room" })
          .sort({ timestamp: 1 })
          .limit(50); // Limit to the latest 50 messages
        
        socket.emit("chatHistory", { messages: messageHistory });
        console.log(`Sent ${messageHistory.length} messages from history to ${senderId}`);
        
        // Let others know a new user joined
        socket.to("global_chat_room").emit("userJoined", { userId: senderId });
      } catch (err) {
        console.error("Error fetching chat history:", err);
      }
    } else {
      // For private chats (not implemented in this update)
      const roomId = [senderId, receiverId].sort().join("_");
      socket.join(roomId);
      console.log(`User ${senderId} and ${receiverId} joined room: ${roomId}`);
    }
  });

  socket.on("sendMessage", async ({ senderId, receiverId, message, image }) => {
    console.log(`Message from ${senderId} to ${receiverId}: ${message || "(image)"}`);
    
    // Handle global chat messages
    if (receiverId === "global_chat_room") {
      const dataToSend = { 
        senderId,
        timestamp: new Date()
      };
      
      if (message) dataToSend.message = message;
      if (image) dataToSend.image = image;
      
      // Store message in database
      try {
        if (message) {
          const newMessage = new Message({
            text: message,
            senderId: senderId,
            room: "global_chat_room"
          });
          await newMessage.save();
        }
        
        io.to("global_chat_room").emit("receiveMessage", dataToSend);
        console.log(`Broadcasting to global_chat_room`);
      } catch (err) {
        console.error("Error saving message:", err);
      }
    } else {
      // Handle private chat messages (not fully implemented in this update)
      const roomId = [senderId, receiverId].sort().join("_");
      const dataToSend = { 
        senderId,
        timestamp: new Date()
      };
      
      if (message) dataToSend.message = message;
      if (image) dataToSend.image = image;
      
      io.to(roomId).emit("receiveMessage", dataToSend);
      console.log(`Sending message to room: ${roomId}`);
    }
  });

  socket.on("disconnect", () => {
    // Find and remove the disconnected user
    for (const [userId, data] of activeUsers.entries()) {
      if (data.socketId === socket.id) {
        console.log(`User ${userId} disconnected`);
        activeUsers.delete(userId);
        
        if (data.inRoom === "global_chat_room") {
          socket.to("global_chat_room").emit("userLeft", { userId });
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));