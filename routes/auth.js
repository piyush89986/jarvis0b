const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateToken } = require('../middleware/auth');
const { protect } = require('../middleware/auth');

// ─────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, branch, semester, college } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Bhai naam, email aur password toh de!' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Is email pe account pehle se hai — login kar' });
    }

    const user = await User.create({
      name,
      email,
      password,
      branch: branch || 'B.Tech',
      semester: semester || 1,
      college: college || '',
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: `Welcome aboard bhai! J.A.R.V.I.S ready hai tere liye 🚀`,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        branch: user.branch,
        semester: user.semester,
        college: user.college,
        preferredLanguage: user.preferredLanguage,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Server error — thoda baad mein try kar', error: error.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email aur password dono chahiye' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Email nahi mila — sahi email de ya register kar' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Password galat hai bhai!' });
    }

    // Update last active
    user.lastActiveDate = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: `Wapas aa gaya! Kya hal hai ${user.name}? 😎`,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        branch: user.branch,
        semester: user.semester,
        college: user.college,
        preferredLanguage: user.preferredLanguage,
        streak: user.streak,
        totalStudyHours: user.totalStudyHours,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/auth/me — Get current user
// ─────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// ─────────────────────────────────────────────
// PATCH /api/auth/profile — Update profile
// ─────────────────────────────────────────────
router.patch('/profile', protect, async (req, res) => {
  try {
    const { name, branch, semester, college, preferredLanguage } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (branch) updateData.branch = branch;
    if (semester) updateData.semester = semester;
    if (college) updateData.college = college;
    if (preferredLanguage) updateData.preferredLanguage = preferredLanguage;

    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    });

    res.json({ success: true, message: 'Profile update ho gaya!', user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
