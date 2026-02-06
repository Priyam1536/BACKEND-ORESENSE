import mongoose from 'mongoose';

const teamInvitationSchema = new mongoose.Schema(
  {
    inviter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    role: {
      type: String,
      default: 'Viewer'
    },
    message: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['Pending', 'Accepted', 'Declined', 'Expired', 'Canceled'],
      default: 'Pending'
    },
    invitedDate: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

const TeamInvitation = mongoose.model('TeamInvitation', teamInvitationSchema);

export default TeamInvitation;
