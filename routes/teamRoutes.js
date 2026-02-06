import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getTeamMembers,
  getInvitations,
  sendInvitation,
  cancelInvitation,
  resendInvitation
} from '../controllers/teamController.js';

const router = express.Router();

router.get('/members', protect, getTeamMembers);
router.get('/invitations', protect, getInvitations);
router.post('/invitations', protect, sendInvitation);
router.post('/invitations/:id/cancel', protect, cancelInvitation);
router.post('/invitations/:id/resend', protect, resendInvitation);

export default router;
