import mongoose from "mongoose";
import fs from "fs";
import path from "path";

// Define the fallback database file path
const DATA_FILE = path.join(process.cwd(), "data-store.json");

// Helper to load fallback data
function loadFallbackData() {
  return { users: [], rooms: [], bookings: [] };
}

// Helper to save fallback data
function saveFallbackData(data) {
  // No-op
}

// Check MongoDB Connection
export const isMongoConnected = true;
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://studynook:studynook@cluster0.mma7vfz.mongodb.net/test?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI, { dbName: "test" })
  .then(() => console.log(`Successfully connected to MongoDB 'test' database`))
  .catch((err) => console.error("MongoDB connection error:", err));

// ==========================================
// Mongoose Schema Definitions (for real MongoDB)
// ==========================================

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: false },
  photoUrl: { type: String, required: false, default: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120" },
  isGoogle: { type: Boolean, default: false },
  bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }]
}, { timestamps: true });

const RoomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  image: { type: String, required: true },
  floor: { type: String, required: true },
  capacity: { type: Number, required: true },
  hourlyRate: { type: Number, required: true },
  amenities: [{ type: String }],
  ownerId: { type: String, required: true },
  bookingCount: { type: Number, default: 0 }
}, { timestamps: true });

const BookingSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  totalCost: { type: Number, required: true },
  specialNote: { type: String },
  status: { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" }
}, { timestamps: true });

export const MongoUser = mongoose.models.User || mongoose.model("User", UserSchema);
export const MongoRoom = mongoose.models.Room || mongoose.model("Room", RoomSchema);
export const MongoBooking = mongoose.models.Booking || mongoose.model("Booking", BookingSchema);

// ==========================================
// Unified DB Interface Layer
// ==========================================

export const db = {
  users: {
    async findOne(query) {
      if (isMongoConnected) {
        return MongoUser.findOne(query).lean();
      } else {
        const data = loadFallbackData();
        return data.users.find(u => {
          if (query.email && u.email.toLowerCase() === query.email.toLowerCase()) return true;
          if (query._id && u._id === query._id) return true;
          return false;
        }) || null;
      }
    },
    async create(userData) {
      if (isMongoConnected) {
        const user = new MongoUser(userData);
        await user.save();
        return user.toObject();
      } else {
        const data = loadFallbackData();
        const newUser = {
          _id: "user_" + Date.now() + Math.random().toString(36).substr(2, 5),
          bookings: [],
          ...userData
        };
        data.users.push(newUser);
        saveFallbackData(data);
        return newUser;
      }
    },
    async findByIdAndUpdate(id, update) {
      if (isMongoConnected) {
        return MongoUser.findByIdAndUpdate(id, update, { new: true }).lean();
      } else {
        const data = loadFallbackData();
        const index = data.users.findIndex(u => u._id === id);
        if (index !== -1) {
          data.users[index] = { ...data.users[index], ...update };
          saveFallbackData(data);
          return data.users[index];
        }
        return null;
      }
    }
  },

  rooms: {
    async find(options = {}) {
      if (isMongoConnected) {
        let filter = {};
        if (options.search) {
          filter.name = { $regex: options.search, $options: "i" };
        }
        if (options.amenities && options.amenities.length > 0) {
          filter.amenities = { $all: options.amenities };
        }
        let queryBuilder = MongoRoom.find(filter);
        if (options.sortLatest) {
          queryBuilder = queryBuilder.sort({ createdAt: -1 });
        }
        if (options.limit) {
          queryBuilder = queryBuilder.limit(options.limit);
        }
        return queryBuilder.lean();
      } else {
        const data = loadFallbackData();
        let list = [...data.rooms];
        if (options.search) {
          const s = options.search.toLowerCase();
          list = list.filter(r => r.name.toLowerCase().includes(s));
        }
        if (options.amenities && options.amenities.length > 0) {
          list = list.filter(r => 
            options.amenities.every(amenity => r.amenities.includes(amenity))
          );
        }
        if (options.sortLatest) {
          // Just simulate sorting by latest
          list.reverse();
        }
        if (options.limit) {
          list = list.slice(0, options.limit);
        }
        return list;
      }
    },
    async findById(id) {
      if (isMongoConnected) {
        return MongoRoom.findById(id).lean();
      } else {
        const data = loadFallbackData();
        return data.rooms.find(r => r._id === id) || null;
      }
    },
    async create(roomData) {
      if (isMongoConnected) {
        const room = new MongoRoom(roomData);
        await room.save();
        return room.toObject();
      } else {
        const data = loadFallbackData();
        const newRoom = {
          _id: "room_" + Date.now() + Math.random().toString(36).substr(2, 5),
          bookingCount: 0,
          ...roomData
        };
        data.rooms.push(newRoom);
        saveFallbackData(data);
        return newRoom;
      }
    },
    async findByIdAndUpdate(id, update) {
      if (isMongoConnected) {
        return MongoRoom.findByIdAndUpdate(id, update, { new: true }).lean();
      } else {
        const data = loadFallbackData();
        const index = data.rooms.findIndex(r => r._id === id);
        if (index !== -1) {
          data.rooms[index] = { ...data.rooms[index], ...update };
          saveFallbackData(data);
          return data.rooms[index];
        }
        return null;
      }
    },
    async findByIdAndDelete(id) {
      if (isMongoConnected) {
        return MongoRoom.findByIdAndDelete(id).lean();
      } else {
        const data = loadFallbackData();
        const filtered = data.rooms.filter(r => r._id !== id);
        const deleted = data.rooms.find(r => r._id === id) || null;
        data.rooms = filtered;
        saveFallbackData(data);
        return deleted;
      }
    }
  },

  bookings: {
    async find(query = {}) {
      if (isMongoConnected) {
        let q = {};
        if (query.userId) q.userId = query.userId;
        if (query.roomId) q.roomId = query.roomId;
        if (query.date) q.date = query.date;
        if (query.status) q.status = query.status;
        
        // Populate room details in MongoDB
        const bookingsList = await MongoBooking.find(q).populate("roomId").lean();
        // Standardize roomId field for frontend (map roomId object to include room details)
        return bookingsList.map((b) => ({
          ...b,
          room: b.roomId // embed room details directly
        }));
      } else {
        const data = loadFallbackData();
        let list = [...data.bookings];
        if (query.userId) {
          list = list.filter(b => b.userId === query.userId);
        }
        if (query.roomId) {
          list = list.filter(b => b.roomId === query.roomId);
        }
        if (query.date) {
          list = list.filter(b => b.date === query.date);
        }
        if (query.status) {
          list = list.filter(b => b.status === query.status);
        }
        // Map with room details
        return list.map(b => {
          const room = data.rooms.find(r => r._id === b.roomId) || null;
          return {
            ...b,
            room
          };
        });
      }
    },
    async findById(id) {
      if (isMongoConnected) {
        return MongoBooking.findById(id).lean();
      } else {
        const data = loadFallbackData();
        return data.bookings.find(b => b._id === id) || null;
      }
    },
    async create(bookingData) {
      if (isMongoConnected) {
        const booking = new MongoBooking(bookingData);
        await booking.save();
        
        // $push booking ID into user's bookings array
        await MongoUser.findByIdAndUpdate(bookingData.userId, {
          $push: { bookings: booking._id }
        });

        // $inc bookingCount of the room
        await MongoRoom.findByIdAndUpdate(bookingData.roomId, {
          $inc: { bookingCount: 1 }
        });

        return booking.toObject();
      } else {
        const data = loadFallbackData();
        const newBooking = {
          _id: "booking_" + Date.now() + Math.random().toString(36).substr(2, 5),
          status: "confirmed",
          ...bookingData
        };
        data.bookings.push(newBooking);

        // Push booking ID to user
        const user = data.users.find(u => u._id === bookingData.userId);
        if (user) {
          if (!user.bookings) user.bookings = [];
          user.bookings.push(newBooking._id);
        }

        // Increment room's bookingCount
        const room = data.rooms.find(r => r._id === bookingData.roomId);
        if (room) {
          room.bookingCount = (room.bookingCount || 0) + 1;
        }

        saveFallbackData(data);
        return newBooking;
      }
    },
    async findByIdAndUpdate(id, update) {
      if (isMongoConnected) {
        const booking = await MongoBooking.findByIdAndUpdate(id, update, { new: true }).lean();
        
        // If booking is cancelled, $pull booking ID from user's bookings array and decrement bookingCount
        if (update.status === "cancelled" && booking) {
          await MongoUser.findByIdAndUpdate(booking.userId, {
            $pull: { bookings: id }
          });
          await MongoRoom.findByIdAndUpdate(booking.roomId, {
            $inc: { bookingCount: -1 }
          });
        }
        return booking;
      } else {
        const data = loadFallbackData();
        const index = data.bookings.findIndex(b => b._id === id);
        if (index !== -1) {
          const oldBooking = data.bookings[index];
          data.bookings[index] = { ...oldBooking, ...update };

          // If status became cancelled, do the pull and decrement
          if (update.status === "cancelled" && oldBooking.status !== "cancelled") {
            const user = data.users.find(u => u._id === oldBooking.userId);
            if (user && user.bookings) {
              user.bookings = user.bookings.filter((bId) => bId !== id);
            }
            const room = data.rooms.find(r => r._id === oldBooking.roomId);
            if (room) {
              room.bookingCount = Math.max(0, (room.bookingCount || 0) - 1);
            }
          }

          saveFallbackData(data);
          return data.bookings[index];
        }
        return null;
      }
    },
    async checkConflict(roomId, date, startTime, endTime) {
      if (isMongoConnected) {
        const overlapping = await MongoBooking.findOne({
          roomId: new mongoose.Types.ObjectId(roomId),
          date: date,
          status: "confirmed",
          startTime: { $lt: endTime },
          endTime: { $gt: startTime }
        });
        return !!overlapping;
      } else {
        const data = loadFallbackData();
        const overlapping = data.bookings.find(b => {
          return (
            b.roomId === roomId &&
            b.date === date &&
            b.status === "confirmed" &&
            b.startTime < endTime &&
            b.endTime > startTime
          );
        });
        return !!overlapping;
      }
    }
  }
};
