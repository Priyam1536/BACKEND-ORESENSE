import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d'
  });
};

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
export const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password
    });

    if (user) {
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: generateToken(user._id)
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email }).select('+password');

    // Check if user exists and password matches
    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: generateToken(user._id)
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (user) {
      const fullName = user.name || '';
      const nameParts = fullName.split(' ').filter(Boolean);
      const fallbackFirstName = nameParts[0] || '';
      const fallbackLastName = nameParts.slice(1).join(' ');

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        firstName: user.firstName || fallbackFirstName,
        lastName: user.lastName || fallbackLastName,
        phone: user.phone || '',
        location: user.location || '',
        department: user.department || '',
        position: user.position || '',
        joinDate: user.joinDate || user.createdAt,
        bio: user.bio || '',
        preferences: user.preferences || {}
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

// @desc    Update user profile and preferences
// @route   PUT /api/auth/profile
// @access  Private
export const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const {
      name,
      firstName,
      lastName,
      email,
      phone,
      location,
      department,
      position,
      joinDate,
      bio,
      preferences
    } = req.body || {};

    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email, _id: { $ne: user._id } });
      if (emailExists) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      user.email = email;
    }

    if (typeof phone === 'string') user.phone = phone;
    if (typeof location === 'string') user.location = location;
    if (typeof department === 'string') user.department = department;
    if (typeof position === 'string') user.position = position;
    if (typeof bio === 'string') user.bio = bio;
    if (joinDate) user.joinDate = joinDate;

    if (typeof firstName === 'string') user.firstName = firstName;
    if (typeof lastName === 'string') user.lastName = lastName;

    if (typeof name === 'string' && name.trim()) {
      user.name = name.trim();
    } else if (typeof firstName === 'string' || typeof lastName === 'string') {
      const combinedName = `${firstName || user.firstName || ''} ${lastName || user.lastName || ''}`.trim();
      if (combinedName) {
        user.name = combinedName;
      }
    }

    if (preferences && typeof preferences === 'object') {
      user.preferences = {
        ...user.preferences,
        ...preferences,
        notifications: {
          ...user.preferences?.notifications,
          ...preferences.notifications
        },
        display: {
          ...user.preferences?.display,
          ...preferences.display
        },
        privacy: {
          ...user.preferences?.privacy,
          ...preferences.privacy
        }
      };
    }

    await user.save();

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone || '',
      location: user.location || '',
      department: user.department || '',
      position: user.position || '',
      joinDate: user.joinDate || user.createdAt,
      bio: user.bio || '',
      preferences: user.preferences || {}
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
};
