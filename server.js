// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps)
    const allowedOrigins = [
      'https://inspiring-shereen.vercel.app',
      'http://localhost:5173'
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(bodyParser.json());

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET
});

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Store successful payments temporarily (in production use a database)
const successfulPayments = new Set();
// Store temporary user data
const userDataStore = new Map();

// API to create Razorpay order
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, email, phone } = req.body;

    // Validate input
    if (!fullName || !email || !phone) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Create Razorpay order
    const options = {
      amount: 9900, // 99 rupees in paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      payment_capture: 1 // Auto capture
    };

    const order = await razorpay.orders.create(options);

    // Store user data temporarily
    userDataStore.set(order.id, { fullName, email, phone });

    // Return complete Razorpay configuration
    res.json({
      orderId: order.id,
      amount: order.amount,
      key_id: process.env.RAZORPAY_KEY_ID,
      prefill: {
        name: fullName,
        email: email,
        contact: phone
      },
      // Added: UPI configuration for better app redirects
      config: {
        display: {
          blocks: {
            upi: {
              name: "Pay via UPI",
              instruments: [
                {
                  method: 'upi'
                }
              ]
            },
            card: {
              name: "Pay via Card",
              instruments: [
                {
                  method: 'card'
                }
              ]
            },
            netbanking: {
              name: "Pay via Netbanking",
              instruments: [
                {
                  method: 'netbanking'
                }
              ]
            },
            wallet: {
              name: "Pay via Wallet",
              instruments: [
                {
                  method: 'wallet'
                }
              ]
            }
          },
          sequence: ["block.upi", "block.card", "block.netbanking", "block.wallet"],
          preferences: {
            show_default_blocks: false
          }
        }
      }
    });

  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// API to verify payment signature and process payment
app.post('/api/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    } = req.body;

    // Verify signature
    const text = `${razorpay_order_id}|${razorpay_payment_id}`;
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_SECRET)
      .update(text)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Invalid signature' });
    }

    // Payment verified successfully
    successfulPayments.add(razorpay_payment_id);

    // Get user data from temporary store
    const userData = userDataStore.get(razorpay_order_id);

    if (userData) {
      // Send confirmation email to user
      const userMailOptions = {
        from: process.env.EMAIL_USER,
        to: userData.email,
        subject: 'Your Registration is Confirmed! - Inspiring Shereen Masterclass',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
            <h2 style="color: #7C3AED; text-align: center;">Thank You for Registering!</h2>
            <p>Dear ${userData.fullName},</p>
            <p>Your payment has been successfully processed and your spot in our <strong>Life-Changing 3-Hour Masterclass</strong> is confirmed! 🎉</p>
            
            <div style="background-color: #F5F3FF; padding: 15px; border-radius: 10px; margin: 20px 0;">
              <h3 style="color: #7C3AED; margin-top: 0;">Event Details:</h3>
              <p>📅 <strong>Date:</strong> April 19th</p>
              <p>🕦 <strong>Time:</strong> 11:30 AM</p>
              <p>📍 <strong>Location:</strong> Live on Zoom (Interactive + Reflective Exercises)</p>
              <p>We'll send you the Zoom link and any additional instructions 24 hours before the event.</p>
            </div>
            
            <p>Get ready to break free from stress, confusion & setbacks and take control of your life with clarity and confidence! ✨</p>
            
            <p>If you have any questions before the masterclass, feel free to reply to this email.</p>
            
            <p>Looking forward to helping you transform your life!</p>
            
            <p style="margin-bottom: 0;">Warm regards,</p>
            <p style="margin-top: 5px;"><strong>Inspiring Shereen</strong></p>
            <p style="color: #7C3AED;">Life Coach | Shaping Lives With Holistic Success</p>
          </div>
        `
      };

      // Send email to admin
      const adminMailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        subject: 'New Registration - Inspiring Shereen Masterclass',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #7C3AED;">New Registration!</h2>
            <p>A new participant has registered for the Life Coaching Masterclass:</p>
            
            <ul>
              <li><strong>Full Name:</strong> ${userData.fullName}</li>
              <li><strong>Email:</strong> ${userData.email}</li>
              <li><strong>Phone:</strong> ${userData.phone}</li>
              <li><strong>Payment ID:</strong> ${razorpay_payment_id}</li>
              <li><strong>Order ID:</strong> ${razorpay_order_id}</li>
              <li><strong>Amount Paid:</strong> ₹99</li>
            </ul>
          </div>
        `
      };

      try {
        await transporter.sendMail(userMailOptions);
        await transporter.sendMail(adminMailOptions);
      } catch (emailError) {
        console.error('Email sending error:', emailError);
        // Don't fail the request if email fails
      }

      // Clean up temporary data
      userDataStore.delete(razorpay_order_id);
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ success: false, error: 'Something went wrong' });
  }
});

// API endpoint to check if payment is authentic
app.get('/api/check-payment', (req, res) => {
  const paymentId = req.query.payment_id;

  if (successfulPayments.has(paymentId)) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

// Add a default route for the API
app.get('/api', (req, res) => {
  res.json({ message: 'API is running' });
});

// Add a simple status check route
app.get('/status', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Default route to show server is working
app.get('/', (req, res) => {
  res.send('Server is running. API available at /api endpoints.');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});