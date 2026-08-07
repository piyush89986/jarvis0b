const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name toh batao bhai'],
      trim: true,
      maxlength: [50, 'Naam thoda chhota rakho — 50 chars max'],
    },
    email: {
      type: String,
      required: [true, 'Email chahiye'],
      unique: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Valid email dalo'],
    },
    password: {
      type: String,
      required: [true, 'Password chahiye'],
      minlength: [6, 'Password minimum 6 characters'],
      select: false,
    },
    branch: {
      type: String,
      default: 'B.Tech',
      trim: true,
    },
    semester: {
      type: Number,
      min: 1,
      max: 8,
      default: 1,
    },
    college: {
      type: String,
      default: '',
      trim: true,
    },
    // Jarvis personality preferences
    preferredLanguage: {
      type: String,
      enum: ['hinglish', 'hindi', 'english'],
      default: 'hinglish',
    },
    // Study stats
    totalStudyHours: {
      type: Number,
      default: 0,
    },
    streak: {
      type: Number,
      default: 0,
    },
    lastActiveDate: {
      type: Date,
      default: Date.now,
    },
    avatar: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Hash password before save
// Note: Mongoose 7+ async middleware — next() nahi chahiye, Promise auto-handle hota hai
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});


// Compare password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
