const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
  } catch (err) {
  console.log(err.message);                 // shows full error in terminal
  res.status(500).json({
    message: err.message,
    error: err
  });
    process.exit(1);
  }
};

module.exports = connectDB;
