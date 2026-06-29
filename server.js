import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db } from "./server/db.js";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error(
    "CRITICAL ERROR: JWT_SECRET environment variable is missing in .env!",
  );
}

// CORS Configuration
const allowedOrigins = [process.env.CLIENT_URL].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, postman, curl)
      if (!origin) return callback(null, true);

      const isAllowed =
        allowedOrigins.some((allowed) => origin.startsWith(allowed)) ||
        origin.endsWith(".run.app");
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

// Middlewares
app.use(express.json());
app.use(cookieParser());

// Authentication Middleware
export function authMiddleware(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.userId };
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ error: "Unauthorized: Invalid or expired token" });
  }
}

// ==========================================
// Authentication Endpoints
// ==========================================

// Register
app.post("/api/auth/register", async (req, res) => {
  const { name, email, photoUrl, password } = req.body;

  if (!name || !email || !photoUrl || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  // Password criteria check (At least 6 chars, 1 uppercase, 1 lowercase)
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters long" });
  }
  if (!/[A-Z]/.test(password)) {
    return res
      .status(400)
      .json({ error: "Password must contain at least one uppercase letter" });
  }
  if (!/[a-z]/.test(password)) {
    return res
      .status(400)
      .json({ error: "Password must contain at least one lowercase letter" });
  }

  try {
    const existingUser = await db.users.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "User already exists with this email" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await db.users.create({
      name,
      email,
      photoUrl,
      password: hashedPassword,
    });

    return res
      .status(201)
      .json({ message: "Registration successful! Please login." });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await db.users.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Sign JWT
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none", // Separate domains allow credentials via HTTPS
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    const { password: _, ...userWithoutPassword } = user;
    return res.json({ user: userWithoutPassword });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
});

// Get dynamic Google Client ID for the frontend
app.get("/api/auth/google/client-id", (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn(
      "WARNING: GOOGLE_CLIENT_ID is not set in the server's environment (.env)!",
    );
  }
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || "" });
});

// Continue with Google (Secure Token Verification & Fallback)
app.post("/api/auth/google", async (req, res) => {
  const { credential, name, email, photoUrl } = req.body;

  let finalEmail = email;
  let finalName = name;
  let finalPhoto = photoUrl;

  if (credential) {
    try {
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`,
      );
      if (verifyRes.ok) {
        const payload = await verifyRes.json();
        const allowedClientIds = [process.env.GOOGLE_CLIENT_ID].filter(Boolean);

        if (allowedClientIds.includes(payload.aud)) {
          finalEmail = payload.email;
          finalName = payload.name;
          finalPhoto = payload.picture;
        } else {
          return res.status(400).json({
            error:
              "Google auth failed: Audience/Client ID mismatch. Make sure GOOGLE_CLIENT_ID is configured in .env.",
          });
        }
      } else {
        return res
          .status(400)
          .json({ error: "Google auth failed: Invalid credential token" });
      }
    } catch (err) {
      console.error("Error verifying Google token:", err);
    }
  }

  if (!finalEmail || !finalName) {
    return res.status(400).json({
      error: "Google authentication failed: Name and Email are required",
    });
  }

  try {
    let user = await db.users.findOne({ email: finalEmail });

    // Create user if they don't exist yet
    if (!user) {
      const randomPassword = Math.random().toString(36) + "Gg1!";
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      user = await db.users.create({
        name: finalName,
        email: finalEmail,
        photoUrl:
          finalPhoto ||
          "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120",
        password: hashedPassword,
        isGoogle: true,
      });
    } else if (!user.isGoogle) {
      user = await db.users.findByIdAndUpdate(user._id, { isGoogle: true });
    }

    // Sign JWT
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none", // Allow secure cookies across domains
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    const { password: _, ...userWithoutPassword } = user;
    return res.json({ user: userWithoutPassword });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
  });
  return res.json({ message: "Logged out successfully" });
});
// Get Current User (me)
app.get("/api/auth/me", async (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.json({ user: null });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.users.findOne({ _id: decoded.userId });
    if (!user) {
      return res.json({ user: null });
    }
    const { password: _, ...userWithoutPassword } = user;
    return res.json({ user: userWithoutPassword });
  } catch (error) {
    return res.json({ user: null });
  }
});

// Update Profile
app.put("/api/auth/profile", authMiddleware, async (req, res) => {
  const { name, photoUrl, password } = req.body;

  if (!name || !photoUrl) {
    return res.status(400).json({ error: "Name and photo URL are required" });
  }

  try {
    const user = await db.users.findOne({ _id: req.user.id });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const updateData = { name, photoUrl };

    if (password) {
      if (password.length < 6) {
        return res
          .status(400)
          .json({ error: "Password must be at least 6 characters long" });
      }
      if (!/[A-Z]/.test(password)) {
        return res.status(400).json({
          error: "Password must contain at least one uppercase letter",
        });
      }
      if (!/[a-z]/.test(password)) {
        return res.status(400).json({
          error: "Password must contain at least one lowercase letter",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      updateData.password = hashedPassword;
    }

    const updatedUser = await db.users.findByIdAndUpdate(
      req.user.id,
      updateData,
    );
    const { password: _, ...userWithoutPassword } = updatedUser;

    return res.json({
      message: "Profile updated successfully",
      user: userWithoutPassword,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error.message || "Failed to update profile" });
  }
});
