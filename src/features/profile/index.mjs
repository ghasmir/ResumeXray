/**
 * Profile Feature Module
 * User profile management
 */

import { el, getInitials, timeAgo } from '../../core/utils.mjs';
import { appStore } from '../../core/state.mjs';
import { post } from '../../core/api.mjs';
import { setupPasswordStrength } from '../auth/index.mjs';
import { updateAvatar, changePassword, deleteAccount, logout, getCreditHistory } from '../../services/index.mjs';
import { showToast } from '../../components/toast.mjs';

/**
 * Setup profile page functionality
 */
export function setupProfile() {
  bindProfileState();
  setupVerificationResend();
  setupAvatarUpload();
  setupPasswordChange();
  setupAccountDeletion();
  loadCreditHistory();
}

function bindProfileState() {
  const profileRoot = el('view-profile');
  if (!profileRoot) return;

  renderProfile(appStore.get('user'));
  appStore.subscribe('user', user => {
    renderProfile(user);
    loadCreditHistory();
  });
}

function renderProfile(user) {
  if (!user) return;

  const tierNames = {
    free: 'Free',
    starter: 'Starter',
    pro: 'Professional',
    hustler: 'Career Plus',
  };

  const nameEl = el('profile-name');
  const emailEl = el('profile-email');
  const joinedEl = el('profile-joined');
  const tierEl = el('profile-tier-badge');
  const creditCountEl = el('profile-credit-count');
  const creditBarEl = el('profile-credit-bar');
  const verifiedBadgeEl = el('profile-verified-badge');
  const verifyBannerEl = el('verify-email-banner');
  const passwordSectionEl = el('password-section');
  const providerBadgesEl = el('profile-provider-badges');

  if (nameEl) nameEl.textContent = user.name || 'Your account';
  if (emailEl) emailEl.textContent = user.email || '';
  if (joinedEl) {
    joinedEl.textContent = new Date(user.joinedAt || Date.now()).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }
  if (tierEl) {
    tierEl.textContent = tierNames[user.tier] || 'Free';
    tierEl.className = `tier-badge tier-${user.tier || 'free'}`;
  }
  if (creditCountEl) creditCountEl.textContent = String(user.creditBalance || 0);
  if (creditBarEl) {
    const maxCredits =
      user.tier === 'hustler' ? 50 : user.tier === 'pro' ? 15 : user.tier === 'starter' ? 5 : 1;
    creditBarEl.style.width = `${Math.min(100, ((user.creditBalance || 0) / maxCredits) * 100)}%`;
  }
  if (verifiedBadgeEl) verifiedBadgeEl.style.display = user.isVerified ? 'inline-flex' : 'none';
  if (verifyBannerEl) verifyBannerEl.style.display = !user.isVerified && !user.provider ? 'flex' : 'none';
  if (passwordSectionEl) passwordSectionEl.style.display = user.hasPassword ? 'block' : 'none';
  if (providerBadgesEl) {
    providerBadgesEl.innerHTML = '';
    if (user.provider) {
      providerBadgesEl.style.display = 'flex';
      const badge = document.createElement('span');
      badge.className = 'provider-badge';
      badge.textContent = `${user.provider.charAt(0).toUpperCase()}${user.provider.slice(1)} Connected`;
      providerBadgesEl.appendChild(badge);
    } else {
      providerBadgesEl.style.display = 'none';
    }
  }

  updateAvatarDisplay(user);
}

/**
 * Setup avatar upload
 */
function setupAvatarUpload() {
  const fileInput = el('avatar-file-input');

  if (!fileInput || fileInput.dataset.bound === '1') return;
  fileInput.dataset.bound = '1';

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
      const result = await updateAvatar(file);
      const user = appStore.get('user');
      if (user) updateAvatarDisplay(user);
      showToast('Avatar updated', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to upload avatar', 'error');
    } finally {
      fileInput.value = '';
    }
  });
}

/**
 * Update avatar display
 * @param {Object} user - User data
 */
function updateAvatarDisplay(user) {
  const avatarEl = el('profile-avatar');
  const navAvatarEl = el('nav-avatar') || el('nav-avatar-initials');
  if (!avatarEl) return;

  if (user.avatarUrl || user.avatar) {
    const img = document.createElement('img');
    img.src = user.avatarUrl || user.avatar;
    img.alt = user.name || 'User';

    avatarEl.innerHTML = '';
    avatarEl.appendChild(img.cloneNode());
    if (navAvatarEl) {
      navAvatarEl.innerHTML = '';
      navAvatarEl.appendChild(img);
    }
  } else {
    const initials = getInitials(user.name);
    avatarEl.textContent = initials;
    if (navAvatarEl) navAvatarEl.textContent = initials;
  }
}

/**
 * Setup password change form
 */
function setupPasswordChange() {
  const openBtn = el('btn-change-password');
  const form = el('password-form');
  const modal = el('password-modal');
  const cancelBtn = el('pw-cancel');
  if (!openBtn || !form || !modal) return;

  if (!openBtn.dataset.bound) {
    openBtn.dataset.bound = '1';
    openBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
      document.body.classList.add('modal-open');
      setupPasswordStrength('pw-new', 'profile');
    });
  }

  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = '1';
    cancelBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
      form.reset();
    });
  }

  if (form.dataset.bound === '1') return;
  form.dataset.bound = '1';

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const errorEl = el('pw-error');
    if (errorEl) errorEl.style.display = 'none';

    const currentPassword = el('pw-current').value;
    const newPassword = el('pw-new').value;

    try {
      const result = await changePassword(currentPassword, newPassword);
      form.reset();
      modal.style.display = 'none';
      document.body.classList.remove('modal-open');
      showToast(result.requireRelogin ? 'Password updated. Please sign in again.' : 'Password changed successfully', 'success');
      if (result.requireRelogin) {
        setTimeout(() => logout(), 800);
      }
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message || 'Failed to change password';
        errorEl.style.display = 'block';
      } else {
        showToast(err.message || 'Failed to change password', 'error');
      }
    }
  });
}

/**
 * Setup account deletion
 */
function setupAccountDeletion() {
  const deleteBtn = el('btn-delete-account');
  const deleteForm = el('delete-form');
  const deleteModal = el('delete-modal');
  const cancelBtn = el('delete-cancel');
  if (!deleteBtn || !deleteForm || !deleteModal) return;

  if (!deleteBtn.dataset.bound) {
    deleteBtn.dataset.bound = '1';
    deleteBtn.addEventListener('click', () => {
      deleteModal.style.display = 'flex';
      document.body.classList.add('modal-open');
    });
  }

  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = '1';
    cancelBtn.addEventListener('click', () => {
      deleteModal.style.display = 'none';
      document.body.classList.remove('modal-open');
      deleteForm.reset();
    });
  }

  if (deleteForm.dataset.bound === '1') return;
  deleteForm.dataset.bound = '1';

  deleteForm.addEventListener('submit', async e => {
    e.preventDefault();
    const errorEl = el('delete-error');
    if (errorEl) errorEl.style.display = 'none';
    const confirmEmail = el('delete-confirm-email')?.value?.trim();

    try {
      await deleteAccount(confirmEmail);
      showToast('Account deleted', 'info');
      window.location.href = '/';
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message || 'Failed to delete account';
        errorEl.style.display = 'block';
      } else {
        showToast(err.message || 'Failed to delete account', 'error');
      }
    }
  });
}

function setupVerificationResend() {
  const resendBtn = el('btn-resend-verification');
  if (!resendBtn || resendBtn.dataset.bound === '1') return;
  resendBtn.dataset.bound = '1';

  resendBtn.addEventListener('click', async () => {
    const originalLabel = resendBtn.textContent;
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending...';

    try {
      await post('/auth/resend-verification');
      resendBtn.textContent = 'Sent';
      showToast('Verification email sent. Check your inbox.', 'success');
    } catch (err) {
      resendBtn.disabled = false;
      resendBtn.textContent = originalLabel;
      showToast(err.message || 'Failed to resend verification email', 'error');
    }
  });
}

async function loadCreditHistory() {
  const historyEl = el('profile-credit-history');
  const user = appStore.get('user');
  if (!historyEl || !user) return;

  try {
    const history = await getCreditHistory();
    if (!history.length) {
      historyEl.innerHTML = `
        <div style="text-align:center;padding:1.5rem 0;opacity:0.5">
          <p class="body-sm">Credits appear here when you purchase or use them.</p>
        </div>
      `;
      return;
    }

    historyEl.innerHTML = history
      .map(item => {
        const amount = Number(item.amount || 0);
        const direction = amount > 0 ? 'Earned' : 'Used';
        const rowClass = amount > 0 ? 'credit-amount-pos' : 'credit-amount-neg';
        return `
          <div class="credit-history-row">
            <div>
              <div style="font-weight:500">${item.description || item.type || 'Credit update'}</div>
              <div class="body-xs" style="color:var(--text-muted)">${timeAgo(item.created_at)}</div>
            </div>
            <div class="${rowClass}">
              <span class="credit-label">${direction}</span> ${amount > 0 ? '+' : ''}${amount}
            </div>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    historyEl.innerHTML =
      '<p class="body-sm" style="color:var(--text-muted)">Couldn\'t load credit history.</p>';
  }
}
