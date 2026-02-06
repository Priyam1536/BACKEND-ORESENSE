import TeamInvitation from '../models/TeamInvitation.js';
import User from '../models/User.js';

const getTeamIdForUser = (user) => {
  return user.teamId || user._id;
};

// @desc    Get team members for current user's team
// @route   GET /api/team/members
// @access  Private
export const getTeamMembers = async (req, res) => {
  try {
    const teamId = getTeamIdForUser(req.user);

    const members = await User.find({
      $or: [{ _id: teamId }, { teamId }]
    }).select('name email teamRole lastActive');

    const response = members.map(member => {
      const isOwner = member._id.toString() === teamId.toString();
      return {
        id: member._id,
        name: member.name,
        email: member.email,
        role: member.teamRole || (isOwner ? 'Admin' : 'Member'),
        status: 'Active',
        lastActive: member.lastActive,
        projects: 0
      };
    });

    res.json({ success: true, members: response });
  } catch (error) {
    console.error('Error fetching team members:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch team members' });
  }
};

// @desc    Get invitations sent by current user
// @route   GET /api/team/invitations
// @access  Private
export const getInvitations = async (req, res) => {
  try {
    const status = req.query.status;
    const filter = { inviter: req.user._id };
    if (status) {
      filter.status = status;
    }

    const invitations = await TeamInvitation.find(filter)
      .sort({ invitedDate: -1 })
      .populate('inviter', 'name');

    const response = invitations.map(invite => ({
      id: invite._id,
      email: invite.email,
      role: invite.role,
      invitedBy: invite.inviter?.name || req.user.name || 'You',
      invitedDate: invite.invitedDate,
      status: invite.status
    }));

    res.json({ success: true, invitations: response });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch invitations' });
  }
};

// @desc    Send a team invitation
// @route   POST /api/team/invitations
// @access  Private
export const sendInvitation = async (req, res) => {
  try {
    const { email, role, message } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    if (email.toLowerCase() === req.user.email.toLowerCase()) {
      return res.status(400).json({ success: false, message: 'You cannot invite yourself' });
    }

    const teamId = getTeamIdForUser(req.user);

    const existingMember = await User.findOne({ email: email.toLowerCase(), teamId });
    if (existingMember) {
      return res.status(400).json({ success: false, message: 'User is already in your team' });
    }

    const existingInvite = await TeamInvitation.findOne({
      inviter: req.user._id,
      email: email.toLowerCase(),
      status: 'Pending'
    });

    if (existingInvite) {
      return res.json({
        success: true,
        invitation: {
          id: existingInvite._id,
          email: existingInvite.email,
          role: existingInvite.role,
          invitedBy: req.user.name || 'You',
          invitedDate: existingInvite.invitedDate,
          status: existingInvite.status
        }
      });
    }

    const invitation = await TeamInvitation.create({
      inviter: req.user._id,
      teamId,
      email: email.toLowerCase(),
      role: role || 'Viewer',
      message: message || ''
    });

    res.status(201).json({
      success: true,
      invitation: {
        id: invitation._id,
        email: invitation.email,
        role: invitation.role,
        invitedBy: req.user.name || 'You',
        invitedDate: invitation.invitedDate,
        status: invitation.status
      }
    });
  } catch (error) {
    console.error('Error sending invitation:', error);
    res.status(500).json({ success: false, message: 'Failed to send invitation' });
  }
};

// @desc    Cancel an invitation
// @route   POST /api/team/invitations/:id/cancel
// @access  Private
export const cancelInvitation = async (req, res) => {
  try {
    const invitation = await TeamInvitation.findOne({
      _id: req.params.id,
      inviter: req.user._id
    });

    if (!invitation) {
      return res.status(404).json({ success: false, message: 'Invitation not found' });
    }

    invitation.status = 'Canceled';
    await invitation.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error canceling invitation:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel invitation' });
  }
};

// @desc    Resend an invitation
// @route   POST /api/team/invitations/:id/resend
// @access  Private
export const resendInvitation = async (req, res) => {
  try {
    const invitation = await TeamInvitation.findOne({
      _id: req.params.id,
      inviter: req.user._id
    });

    if (!invitation) {
      return res.status(404).json({ success: false, message: 'Invitation not found' });
    }

    invitation.status = 'Pending';
    invitation.invitedDate = new Date();
    await invitation.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error resending invitation:', error);
    res.status(500).json({ success: false, message: 'Failed to resend invitation' });
  }
};
