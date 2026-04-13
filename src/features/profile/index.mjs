/**
 * Profile Feature Module
 * User profile management
 */

import { el, getInitials } from '../core/utils.mjs';
import { appStore } from '../../core/state.mjs';
import {
  updateUser,
  updateAvatar,
  changePassword,
  deleteAccount,
  logout,
} from '../../services/index.mjs';
import { showToast } from '../../components/toast.mjs';
import { confirmDialog } from '../../components/modal.mjs';

/**
 * Setup profile page functionality
 */
export function setupProfile() {
  setupProfileForm();
  setupAvatarUpload();
  setupPasswordChange();
  setupAccountDeletion();
}

/**
 * Setup profile form
 */
function setupProfileForm() {
  const form = el('profile-form');
  if (!form) return;

  // Load current values
  const user = appStore.get('user');
  if (user) {
    const nameInput = el('profile-name');
    const emailInput = el('profile-email');

    if (nameInput) nameInput.value = user.name || '';
    if (emailInput) emailInput.value = user.email || '';
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const name = el('profile-name').value.trim();
    const updates = { name };

    try {
      await updateUser(updates);
      showToast('Profile updated successfully', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update profile', 'error');
    }
  });
}

/**
 * Setup avatar upload
 */
function setupAvatarUpload() {
  const uploadBtn = el('avatar-upload-btn');
  const fileInput = el('avatar-file-input');

  if (!uploadBtn || !fileInput) return;

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showToast('Image must be under 2MB', 'error');
      return;
    }

    try {
      const user = await updateAvatar(file);
      updateAvatarDisplay(user);
      showToast('Avatar updated', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to upload avatar', 'error');
    }
  });
}

/**
 * Update avatar display
 * @param {Object} user - User data
 */
function updateAvatarDisplay(user) {
  const avatarEl = el('profile-avatar');
  const navAvatarEl = el('nav-avatar');

  if (user.avatarUrl) {
    const img = document.createElement('img');
    img.src = user.avatarUrl;
    img.alt = user.name || 'User';

    if (avatarEl) {
      avatarEl.innerHTML = '';
      avatarEl.appendChild(img.cloneNode());
    }
    if (navAvatarEl) {
      navAvatarEl.innerHTML = '';
      navAvatarEl.appendChild(img);
    }
  } else {
    const initials = getInitials(user.name);
    if (avatarEl) avatarEl.textContent = initials;
    if (navAvatarEl) navAvatarEl.textContent = initials;
  }
}

/**
 * Setup password change form
 */
function setupPasswordChange() {
  const form = el('password-change-form');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const currentPassword = el('current-password').value;
    const newPassword = el('new-password').value;
    const confirmPassword = el('confirm-password').value;

    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match', 'error');
      return;
    }

    try {
      await changePassword(currentPassword, newPassword);
      form.reset();
      showToast('Password changed successfully', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to change password', 'error');
    }
  });
}

/**
 * Setup account deletion
 */
function setupAccountDeletion() {
  const deleteBtn = el('delete-account-btn');
  if (!deleteBtn) return;

  deleteBtn.addEventListener('click', async () => {
    const confirmed = await confirmDialog(
      'Are you sure you want to delete your account? This will permanently remove all your data and cannot be undone.',
      'Delete Account',
      { confirmText: 'Delete Forever', confirmClass: 'btn-danger' }
    );

    if (!confirmed) return;

    // Require password confirmation
    const password = prompt('Please enter your password to confirm:');
    if (!password) return;

    try {
      await deleteAccount();
      await logout();
      showToast('Account deleted', 'info');
    } catch (err) {
      showToast(err.message || 'Failed to delete account', 'error');
    }
  });
}
