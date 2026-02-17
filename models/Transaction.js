const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // The Actor
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // The Recipient
  type: { 
    type: String, 
    enum: ["debit","credit"], 
    required: true 
  },
  amount: { type: Number, required: true },
  description: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Transaction", transactionSchema);