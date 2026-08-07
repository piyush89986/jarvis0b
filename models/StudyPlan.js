const mongoose = require('mongoose');

const studyPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
    },
    subjectsStudied: [
      {
        subject: String,
        topics: [String],
        hoursSpent: Number,
        confidence: {
          type: String,
          enum: ['low', 'medium', 'high'],
          default: 'medium',
        },
      },
    ],
    totalHours: {
      type: Number,
      default: 0,
    },
    notes: {
      type: String,
      default: '',
    },
    mood: {
      type: String,
      enum: ['stressed', 'okay', 'focused', 'great'],
      default: 'okay',
    },
    goals: [
      {
        goal: String,
        completed: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

studyPlanSchema.index({ userId: 1, date: -1 });

module.exports = mongoose.model('StudyPlan', studyPlanSchema);
