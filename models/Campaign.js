const mongoose = require("mongoose");

// ✅ PROPER SUBDOCUMENT SCHEMA
const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  type: { type: String, required: true }
});

const campaignSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    required: true
  },
  title: { 
    type: String, 
    required: true,
    trim: true 
  },
  message: { 
    type: String, 
    required: true 
  },
  phoneNumbers: [String],
  status: { 
    type: String, 
    enum: ["pending", 'processing', 'completed', 'rejected'],
    default: "pending"
  },
  media: [mediaSchema] , // ✅ PROPER REFERENCE
  report: {
  type: {
    fileUrl: String,
    fileKey: String,
    uploadedAt: Date,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  default: null
},
}, { timestamps: true });

module.exports = mongoose.model("Campaign", campaignSchema);
