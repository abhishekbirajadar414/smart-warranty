/**
 * ============================================================================
 * SMART WARRANTY - Digital Product Warranty Management System
 * Core Client-Side Logic, Storage Engines & UI Controllers
 * (Pure Vanilla JavaScript - ES6, Strictly Zero Dependencies)
 * ============================================================================
 * 
 * VIVA EXPLANATION GUIDE FOR ENGINEERING STUDENTS:
 * ----------------------------------------------------------------------------
 * 1. Architecture:
 *    - Pure Vanilla Web stack (HTML5, CSS3, ES6 JavaScript).
 *    - Multi-page application with modular client-side controllers.
 *    - Strict separation of concerns: storage layers, calculation engines,
 *      DOM renderers, and event dispatchers.
 * 
 * 2. Dual Storage Layer Architecture:
 *    a) LocalStorage (WarrantyStore & SettingsStore):
 *       - Single persistent source of truth for structured warranty records.
 *       - Storage key: 'smart_warranty_records' (products) & 'smart_warranty_settings' (config).
 *       - Stores product metadata only (ID, names, dates, pricing, categories,
 *         and attachment metadata: ID, filename, MIME type, size, upload timestamp).
 *       - Prevents LocalStorage 5MB quota exhaustion by decoupling binary files.
 *       - Seeded with 4 demonstration records ONLY on first run (when key is null).
 *       - If the user deletes all items, the store remains empty ([]) and never
 *         auto-reseeds demo records unexpectedly.
 *    b) IndexedDB (AttachmentStore):
 *       - Native client-side asynchronous object database ('SmartWarrantyDB').
 *       - Object store: 'attachments' keyed by unique attachment ID.
 *       - Stores actual binary Blobs/Files (PDF invoices, PNG/JPG/WebP receipts).
 *       - Supports files up to 5MB with client-side type and size validation.
 * 
 * 3. Complete Self-Contained Backup & Restore:
 *    - `exportBackup()` gathers warranty records and encodes attached invoices into
 *      Base64 data URLs inside a unified JSON backup file.
 *    - `importBackup()` validates backup structure, prompts user confirmation,
 *      writes records to LocalStorage, converts Base64 back to Blobs, and saves
 *      them into IndexedDB. Also maintains backward compatibility with legacy formats.
 * 
 * 4. Cross-Tab Real-Time Synchronization:
 *    - Uses the browser's native 'storage' event on the window object.
 *    - When product records are modified in one tab, other open tabs detect the
 *      key change, reload from LocalStorage, and selectively update the active view.
 * 
 * 5. Date & Expiration Calculation Engine:
 *    - Computes exact expiration dates considering leap years and variable month lengths.
 *    - Calculates remaining days using UTC-midnight epoch timestamps to prevent DST distortion.
 *    - Classifies warranties based on user-configurable threshold (default 30 days):
 *      * Active: > threshold remaining (Green)
 *      * Expiring Soon: 0 to threshold remaining (Amber)
 *      * Expired: < 0 days remaining (Red)
 * 
 * 6. Security & Memory Management:
 *    - All dynamic user inputs are sanitized with `escapeHTML` prior to DOM interpolation.
 *    - Generated Object URLs are tracked and explicitly revoked (`URL.revokeObjectURL`).
 * ============================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. DOM ELEMENT REFERENCES (CACHED SELECTORS)
  // --------------------------------------------------------------------------
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  const navLinks = document.querySelectorAll('.nav-link');

  // Object URL lifecycle tracker to prevent browser memory leaks
  const activeObjectUrls = new Set();

  function createTrackedObjectUrl(blob) {
    const url = URL.createObjectURL(blob);
    activeObjectUrls.add(url);
    return url;
  }

  function revokeAllObjectUrls() {
    activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    activeObjectUrls.clear();
  }

  window.addEventListener('beforeunload', revokeAllObjectUrls);

  // --------------------------------------------------------------------------
  // 2. MOBILE SIDEBAR NAVIGATION HANDLERS
  // --------------------------------------------------------------------------
  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
    if (menuToggleBtn) menuToggleBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
    if (menuToggleBtn) menuToggleBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function toggleSidebar() {
    if (sidebar && sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  if (menuToggleBtn) {
    menuToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });
  }

  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
      closeSidebar();
    }
  });

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  // --------------------------------------------------------------------------
  // 3. ACTIVE NAVIGATION LINK SYNCHRONIZATION
  // --------------------------------------------------------------------------
  function highlightCurrentPage() {
    const currentPath = window.location.pathname;
    const currentFile = currentPath.substring(currentPath.lastIndexOf('/') + 1) || 'index.html';

    navLinks.forEach(link => {
      const linkHref = link.getAttribute('href');
      if (!linkHref) return;
      const linkFile = linkHref.substring(linkHref.lastIndexOf('/') + 1) || 'index.html';

      if (currentFile === linkFile || (currentFile === '' && linkFile === 'index.html')) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
    });
  }
  highlightCurrentPage();

  // --------------------------------------------------------------------------
  // 4. UTILITY & SECURITY HELPERS
  // --------------------------------------------------------------------------

  /**
   * Sanitizes untrusted user inputs before injecting into innerHTML.
   * Prevents Cross-Site Scripting (XSS).
   */
  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Generates an ISO YYYY-MM-DD date string offset from today by calendar days.
   */
  function createRelativeISODate(daysOffset) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Generates a 2-letter avatar code from a product name.
   */
  function generateAvatar(name) {
    if (!name) return 'PR';
    const clean = String(name).trim();
    const words = clean.split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return clean.substring(0, 2).toUpperCase();
  }

  /**
   * Formats a date string or object into "DD MMM YYYY" (e.g. "15 Jan 2026").
   */
  function formatDisplayDate(dateInput) {
    if (!dateInput) return '—';
    let d;
    if (typeof dateInput === 'string' && dateInput.includes('-')) {
      const [year, month, day] = dateInput.split('T')[0].split('-').map(Number);
      d = new Date(year, month - 1, day);
    } else {
      d = new Date(dateInput);
    }
    if (isNaN(d.getTime())) return '—';

    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  /**
   * Formats a numeric price into Indian Rupees: e.g. "₹24,999".
   */
  function formatCurrencyINR(amount) {
    const num = Number(amount);
    if (isNaN(num)) return '₹0';
    return '₹' + num.toLocaleString('en-IN');
  }

  /**
   * Formats bytes into human-readable file sizes (e.g. "420 KB", "2.4 MB").
   */
  function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Automatically calculates warranty expiry date from purchase date and duration.
   * Handles leap years and varying month lengths precisely.
   * 
   * @param {string} purchaseDateStr - "YYYY-MM-DD"
   * @param {number} duration - Positive number
   * @param {string} unit - 'months' or 'years'
   * @returns {string|null} Expiry date in "YYYY-MM-DD" or null
   */
  function calculateExpiryDate(purchaseDateStr, duration, unit) {
    if (!purchaseDateStr || isNaN(duration) || duration <= 0) return null;
    const parts = purchaseDateStr.split('T')[0].split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;

    const [year, month, day] = parts;
    if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;

    let targetYear, targetMonth, targetDay;
    if (unit === 'years') {
      targetYear = year + Number(duration);
      targetMonth = month - 1;
      // Handle leap day Feb 29
      if (month === 2 && day === 29) {
        const isLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
        targetDay = isLeap ? 29 : 28;
      } else {
        targetDay = day;
      }
    } else {
      // Months addition with end-of-month clamping
      const totalMonths = (year * 12 + (month - 1)) + Number(duration);
      targetYear = Math.floor(totalMonths / 12);
      targetMonth = totalMonths % 12;
      const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
      targetDay = Math.min(day, daysInTargetMonth);
    }

    const targetDate = new Date(targetYear, targetMonth, targetDay);
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Calculates the integer difference in calendar days between an expiry date and today.
   * Uses UTC-midnight timestamps to eliminate daylight-saving shifts.
   */
  function calculateRemainingDays(expiryDateStr) {
    if (!expiryDateStr) return 0;
    const parts = expiryDateStr.split('T')[0].split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0])) return 0;

    const [y, m, d] = parts;
    const expiryUtc = Date.UTC(y, m - 1, d);
    const now = new Date();
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

    const diffMillis = expiryUtc - todayUtc;
    return Math.round(diffMillis / (1000 * 60 * 60 * 24));
  }

  /**
   * Resolves warranty status badge classes, labels, and countdown chips.
   * Uses user-configured alert threshold (default: 30 days).
   */
  function resolveWarrantyStatus(remainingDays) {
    const threshold = SettingsStore.getExpiryThreshold();

    if (remainingDays < 0) {
      return {
        code: 'expired',
        label: 'Expired',
        badgeClass: 'badge-expired',
        chipClass: 'countdown-chip expired',
        chipText: `Expired ${Math.abs(remainingDays)}d ago`,
        avatarClass: 'expired'
      };
    } else if (remainingDays <= threshold) {
      return {
        code: 'expiring',
        label: `Expiring Soon (${remainingDays}d)`,
        badgeClass: 'badge-expiring',
        chipClass: 'countdown-chip expiring',
        chipText: `${remainingDays}d remaining`,
        avatarClass: 'expiring'
      };
    } else {
      return {
        code: 'active',
        label: 'Active',
        badgeClass: 'badge-active',
        chipClass: 'countdown-chip active',
        chipText: `${remainingDays}d left`,
        avatarClass: 'active'
      };
    }
  }

  /**
   * Converts a Blob to a Base64 Data URL.
   */
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Converts a Base64 Data URL back to a binary Blob.
   */
  function dataUrlToBlob(dataUrl) {
    try {
      const parts = dataUrl.split(';base64,');
      if (parts.length !== 2) return null;
      const contentType = parts[0].split(':')[1];
      const raw = window.atob(parts[1]);
      const rawLength = raw.length;
      const uInt8Array = new Uint8Array(rawLength);
      for (let i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
      }
      return new Blob([uInt8Array], { type: contentType });
    } catch (e) {
      console.warn('Failed to convert dataUrl to Blob:', e);
      return null;
    }
  }

  /**
   * Creates a minimal, valid 1-page sample PDF Blob for demonstration.
   */
  function createSamplePdfBlob() {
    const pdfData = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 56 >>
stream
BT
/F1 18 Tf
50 720 Td
(Smart Warranty - Official Purchase Invoice) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000261 00000 n 
0000000342 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
450
%%EOF`;
    return new Blob([pdfData], { type: 'application/pdf' });
  }

  // --------------------------------------------------------------------------
  // 5. USER PREFERENCES STORE (SettingsStore - LocalStorage)
  // --------------------------------------------------------------------------
  const SettingsStore = {
    SETTINGS_KEY: 'smart_warranty_settings',

    getSettings() {
      try {
        const raw = localStorage.getItem(this.SETTINGS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed;
        }
      } catch (e) {}
      return { expiryThreshold: 30, dateFormat: 'DD-MMM-YYYY' };
    },

    getExpiryThreshold() {
      const s = this.getSettings();
      const val = parseInt(s.expiryThreshold, 10);
      return (!isNaN(val) && val > 0) ? val : 30;
    },

    saveSettings(newSettings) {
      try {
        const current = this.getSettings();
        const merged = { ...current, ...newSettings };
        localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(merged));
      } catch (e) {
        console.warn('Failed to save settings:', e);
      }
    }
  };

  // --------------------------------------------------------------------------
  // 6. ATTACHMENT STORAGE ENGINE (IndexedDB - SmartWarrantyDB)
  // --------------------------------------------------------------------------
  const AttachmentStore = {
    DB_NAME: 'SmartWarrantyDB',
    DB_VERSION: 1,
    STORE_NAME: 'attachments',
    _memoryFallback: new Map(),

    openDB() {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return Promise.resolve(null);
      }
      return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    },

    async save(record) {
      try {
        const db = await this.openDB();
        if (!db) {
          this._memoryFallback.set(record.id, record);
          return record.id;
        }
        return new Promise((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.put(record);
          req.onsuccess = () => resolve(record.id);
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn('AttachmentStore save failed, using memory fallback:', err);
        this._memoryFallback.set(record.id, record);
        return record.id;
      }
    },

    async get(id) {
      try {
        const db = await this.openDB();
        if (!db) {
          return this._memoryFallback.get(id) || null;
        }
        return new Promise((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readonly');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn('AttachmentStore get failed:', err);
        return this._memoryFallback.get(id) || null;
      }
    },

    async delete(id) {
      try {
        const db = await this.openDB();
        if (!db) {
          this._memoryFallback.delete(id);
          return true;
        }
        return new Promise((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.delete(id);
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn('AttachmentStore delete failed:', err);
        this._memoryFallback.delete(id);
        return true;
      }
    },

    async clearAll() {
      try {
        this._memoryFallback.clear();
        const db = await this.openDB();
        if (!db) return true;
        return new Promise((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readwrite');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.clear();
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn('AttachmentStore clearAll failed:', err);
        return true;
      }
    },

    async getAll() {
      try {
        const db = await this.openDB();
        if (!db) {
          return Array.from(this._memoryFallback.values());
        }
        return new Promise((resolve, reject) => {
          const tx = db.transaction(this.STORE_NAME, 'readonly');
          const store = tx.objectStore(this.STORE_NAME);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        return Array.from(this._memoryFallback.values());
      }
    },

    async seedDemoAttachment() {
      try {
        const existing = await this.get('att-demo-01');
        if (!existing) {
          const demoBlob = createSamplePdfBlob();
          await this.save({
            id: 'att-demo-01',
            productId: 'prod-01',
            name: 'apple-tax-invoice-2024.pdf',
            type: 'application/pdf',
            size: demoBlob.size || 430080,
            blob: demoBlob,
            uploadedAt: new Date(Date.now() - 120 * 86400000).toISOString()
          });
        }
      } catch (err) {
        console.warn('Seed demo attachment error:', err);
      }
    }
  };

  // --------------------------------------------------------------------------
  // 7. DEMONSTRATION PRODUCT DATASET (4 Core Demonstration Items)
  // --------------------------------------------------------------------------
  const DEMO_PRODUCTS = [
    {
      id: 'prod-01',
      productName: 'Apple MacBook Pro 14-inch',
      name: 'Apple MacBook Pro 14-inch',
      brand: 'Apple',
      category: 'Electronics',
      avatar: 'MB',
      serialNumber: 'C02G41H1MD6R',
      serial: 'C02G41H1MD6R',
      purchaseDate: createRelativeISODate(-120),
      purchasePrice: 199900,
      price: '₹1,99,900',
      warrantyDuration: 3,
      warrantyUnit: 'years',
      durationMonths: 36,
      expiryDate: createRelativeISODate(975), // Active (~975 days left)
      notes: 'AppleCare+ Protection Plan with comprehensive hardware coverage.',
      createdAt: new Date(Date.now() - 120 * 86400000).toISOString(),
      attachment: {
        id: 'att-demo-01',
        name: 'apple-tax-invoice-2024.pdf',
        type: 'application/pdf',
        size: 430080,
        uploadedAt: new Date(Date.now() - 120 * 86400000).toISOString()
      }
    },
    {
      id: 'prod-02',
      productName: 'Sony WH-1000XM5',
      name: 'Sony WH-1000XM5',
      brand: 'Sony',
      category: 'Electronics',
      avatar: 'SN',
      serialNumber: 'S01-9238472',
      serial: 'S01-9238472',
      purchaseDate: createRelativeISODate(-348),
      purchasePrice: 29990,
      price: '₹29,990',
      warrantyDuration: 12,
      warrantyUnit: 'months',
      durationMonths: 12,
      expiryDate: createRelativeISODate(17), // Expiring Soon (17 days remaining)
      notes: 'Standard manufacturer limited warranty for noise-canceling headphones.',
      createdAt: new Date(Date.now() - 348 * 86400000).toISOString(),
      attachment: null
    },
    {
      id: 'prod-03',
      productName: 'Samsung Galaxy S24',
      name: 'Samsung Galaxy S24',
      brand: 'Samsung',
      category: 'Smartphone',
      avatar: 'SG',
      serialNumber: 'SM-S921B-01',
      serial: 'SM-S921B-01',
      purchaseDate: createRelativeISODate(-90),
      purchasePrice: 79999,
      price: '₹79,999',
      warrantyDuration: 1,
      warrantyUnit: 'years',
      durationMonths: 12,
      expiryDate: createRelativeISODate(275), // Active (~275 days left)
      notes: 'Samsung Care+ standard warranty coverage.',
      createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      attachment: null
    },
    {
      id: 'prod-04',
      productName: 'LG Microwave Oven',
      name: 'LG Microwave Oven',
      brand: 'LG',
      category: 'Home Appliance',
      avatar: 'LG',
      serialNumber: 'LG-MW28401',
      serial: 'LG-MW28401',
      purchaseDate: createRelativeISODate(-420),
      purchasePrice: 14990,
      price: '₹14,990',
      warrantyDuration: 12,
      warrantyUnit: 'months',
      durationMonths: 12,
      expiryDate: createRelativeISODate(-55), // Expired 55 days ago
      notes: '1-Year comprehensive warranty on cavity and magnetron.',
      createdAt: new Date(Date.now() - 420 * 86400000).toISOString(),
      attachment: null
    }
  ];

  // --------------------------------------------------------------------------
  // 8. PRIMARY DATA STORE (WarrantyStore - Single Source of Truth)
  // --------------------------------------------------------------------------
  const WarrantyStore = {
    STORAGE_KEY: 'smart_warranty_records',
    _cache: null,

    init() {
      if (this._cache !== null) return this._cache;

      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (raw === null) {
          // Strictly first-time initialization
          this._cache = JSON.parse(JSON.stringify(DEMO_PRODUCTS));
          this._persist();
          AttachmentStore.seedDemoAttachment();
        } else {
          const parsed = JSON.parse(raw);
          this._cache = Array.isArray(parsed) ? parsed : [];
        }
      } catch (err) {
        console.warn('LocalStorage read/parse error, fallback to empty array:', err);
        this._cache = [];
      }

      this.updateSidebarBadge();
      return this._cache;
    },

    _persist() {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._cache));
      } catch (err) {
        console.error('LocalStorage write failed:', err);
        if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
          alert('Warning: Browser storage quota exceeded. Please export backup and clear older records.');
        }
      }
      this.updateSidebarBadge();
    },

    reloadFromStorage() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          this._cache = Array.isArray(parsed) ? parsed : [];
        } else {
          this._cache = [];
        }
      } catch (err) {
        this._cache = [];
      }
      this.updateSidebarBadge();
      return this._cache;
    },

    updateSidebarBadge() {
      const badges = document.querySelectorAll('#navWarrantyCount, .nav-badge');
      if (badges.length > 0 && this._cache) {
        badges.forEach(b => {
          b.textContent = this._cache.length;
        });
      }
    },

    getAll() {
      if (this._cache === null) this.init();
      return [...this._cache];
    },

    getById(id) {
      if (this._cache === null) this.init();
      return this._cache.find(p => p.id === id) || null;
    },

    add(productData) {
      if (this._cache === null) this.init();
      const uniqueId = 'prod-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7);

      const newProduct = {
        id: uniqueId,
        createdAt: new Date().toISOString(),
        productName: (productData.productName || '').trim(),
        name: (productData.productName || '').trim(),
        brand: (productData.brand || '').trim(),
        category: productData.category || 'Other',
        serialNumber: (productData.serialNumber || '').trim(),
        serial: (productData.serialNumber || '').trim(),
        purchaseDate: productData.purchaseDate,
        purchasePrice: Number(productData.purchasePrice) || 0,
        price: formatCurrencyINR(productData.purchasePrice || 0),
        warrantyDuration: Number(productData.warrantyDuration) || 12,
        warrantyUnit: productData.warrantyUnit || 'months',
        durationMonths: productData.warrantyUnit === 'years' 
          ? Number(productData.warrantyDuration) * 12 
          : Number(productData.warrantyDuration),
        expiryDate: productData.expiryDate,
        notes: (productData.notes || '').trim(),
        avatar: generateAvatar(productData.productName),
        attachment: productData.attachment || null
      };

      this._cache.unshift(newProduct);
      this._persist();
      return newProduct;
    },

    update(id, updatedData) {
      if (this._cache === null) this.init();
      const index = this._cache.findIndex(p => p.id === id);
      if (index === -1) return null;

      const existing = this._cache[index];
      const durationMonths = updatedData.warrantyUnit === 'years' 
        ? Number(updatedData.warrantyDuration) * 12 
        : Number(updatedData.warrantyDuration);

      const attachment = updatedData.attachment !== undefined 
        ? updatedData.attachment 
        : (existing.attachment || null);

      this._cache[index] = {
        ...existing,
        productName: (updatedData.productName !== undefined ? updatedData.productName : existing.productName).trim(),
        name: (updatedData.productName !== undefined ? updatedData.productName : existing.name).trim(),
        brand: (updatedData.brand !== undefined ? updatedData.brand : existing.brand).trim(),
        category: updatedData.category || existing.category,
        serialNumber: (updatedData.serialNumber !== undefined ? updatedData.serialNumber : existing.serialNumber).trim(),
        serial: (updatedData.serialNumber !== undefined ? updatedData.serialNumber : existing.serial).trim(),
        purchaseDate: updatedData.purchaseDate || existing.purchaseDate,
        purchasePrice: updatedData.purchasePrice !== undefined ? Number(updatedData.purchasePrice) : existing.purchasePrice,
        price: formatCurrencyINR(updatedData.purchasePrice !== undefined ? updatedData.purchasePrice : existing.purchasePrice),
        warrantyDuration: Number(updatedData.warrantyDuration) || existing.warrantyDuration,
        warrantyUnit: updatedData.warrantyUnit || existing.warrantyUnit,
        durationMonths: durationMonths,
        expiryDate: updatedData.expiryDate || existing.expiryDate,
        notes: (updatedData.notes !== undefined ? updatedData.notes : existing.notes).trim(),
        avatar: generateAvatar(updatedData.productName || existing.productName),
        attachment: attachment
      };

      this._persist();
      return this._cache[index];
    },

    delete(id) {
      if (this._cache === null) this.init();
      const target = this._cache.find(p => p.id === id);
      if (target && target.attachment && target.attachment.id) {
        AttachmentStore.delete(target.attachment.id).catch(err => {
          console.warn('Failed to delete attachment from IndexedDB:', err);
        });
      }

      const initialCount = this._cache.length;
      this._cache = this._cache.filter(p => p.id !== id);
      this._persist();
      return this._cache.length < initialCount;
    },

    clearAll() {
      this._cache = [];
      this._persist();
      AttachmentStore.clearAll().catch(err => {
        console.warn('IndexedDB clearAll error:', err);
      });
      return true;
    },

    resetDemo() {
      this._cache = JSON.parse(JSON.stringify(DEMO_PRODUCTS));
      this._persist();
      AttachmentStore.seedDemoAttachment();
      return this._cache;
    },

    /**
     * Exports complete, self-contained backup bundling records AND attached bills (Base64).
     */
    async exportBackup() {
      if (this._cache === null) this.init();

      const backupPackage = {
        format: 'smart-warranty-backup',
        version: '1.0',
        exportedAt: new Date().toISOString(),
        recordCount: this._cache.length,
        records: this._cache,
        attachments: []
      };

      for (const p of this._cache) {
        if (p.attachment && p.attachment.id) {
          try {
            const attRecord = await AttachmentStore.get(p.attachment.id);
            if (attRecord && attRecord.blob) {
              const dataUrl = await blobToDataUrl(attRecord.blob);
              backupPackage.attachments.push({
                id: attRecord.id,
                name: attRecord.name,
                type: attRecord.type,
                size: attRecord.size,
                uploadedAt: attRecord.uploadedAt,
                dataUrl: dataUrl
              });
            }
          } catch (e) {
            console.warn(`Could not package attachment ${p.attachment.id}:`, e);
          }
        }
      }

      return JSON.stringify(backupPackage, null, 2);
    },

    /**
     * Validates and imports a JSON backup string (supports both v1.0 bundle and legacy arrays).
     */
    async importBackup(jsonString) {
      let data;
      try {
        data = JSON.parse(jsonString);
      } catch (e) {
        throw new Error('Malformed file: The selected file is not valid JSON.');
      }

      let rawRecords = [];
      let rawAttachments = [];
      let isFullBackup = false;

      if (data && typeof data === 'object' && Array.isArray(data.records)) {
        // v1.0 Unified Backup schema
        rawRecords = data.records;
        rawAttachments = Array.isArray(data.attachments) ? data.attachments : [];
        isFullBackup = true;
      } else if (Array.isArray(data)) {
        // Legacy flat array schema
        rawRecords = data;
        rawAttachments = [];
        isFullBackup = false;
      } else {
        throw new Error('Invalid schema: Backup must contain a valid records array.');
      }

      // Validate records
      const validatedRecords = rawRecords.map((item, index) => {
        const name = (item.productName || item.name || '').trim();
        if (!name) {
          throw new Error(`Record #${index + 1} is missing a required product name.`);
        }
        const pDate = item.purchaseDate || createRelativeISODate(-30);
        const dur = Number(item.warrantyDuration) || 12;
        const unit = item.warrantyUnit || 'months';
        const calculatedExpiry = item.expiryDate || calculateExpiryDate(pDate, dur, unit);

        return {
          id: item.id || ('prod-imp-' + Date.now().toString(36) + '-' + index),
          productName: name,
          name: name,
          brand: (item.brand || 'Unknown').trim(),
          category: item.category || 'Other',
          serialNumber: (item.serialNumber || item.serial || '').trim(),
          serial: (item.serialNumber || item.serial || '').trim(),
          purchaseDate: pDate,
          purchasePrice: Number(item.purchasePrice) || 0,
          price: formatCurrencyINR(item.purchasePrice || 0),
          warrantyDuration: dur,
          warrantyUnit: unit,
          durationMonths: unit === 'years' ? dur * 12 : dur,
          expiryDate: calculatedExpiry,
          notes: (item.notes || '').trim(),
          avatar: generateAvatar(name),
          attachment: item.attachment || null,
          createdAt: item.createdAt || new Date().toISOString()
        };
      });

      // Restore records to LocalStorage
      this._cache = validatedRecords;
      this._persist();

      // Restore attachments to IndexedDB
      let restoredAttCount = 0;
      for (const att of rawAttachments) {
        if (att && att.id && att.dataUrl) {
          const blob = dataUrlToBlob(att.dataUrl);
          if (blob) {
            await AttachmentStore.save({
              id: att.id,
              name: att.name || 'document.pdf',
              type: att.type || blob.type,
              size: att.size || blob.size,
              blob: blob,
              uploadedAt: att.uploadedAt || new Date().toISOString()
            });
            restoredAttCount++;
          }
        }
      }

      return {
        recordCount: validatedRecords.length,
        attachmentCount: restoredAttCount,
        isFullBackup: isFullBackup
      };
    }
  };

  // Initialize store immediately on load
  WarrantyStore.init();

  // --------------------------------------------------------------------------
  // 9. ACTIVE VIEW DISPATCHER (CROSS-TAB SYNC & PAGE RENDERER)
  // --------------------------------------------------------------------------
  function renderActivePage() {
    if (document.getElementById('statTotal')) {
      renderDashboard();
    } else if (document.getElementById('warrantiesTableBody')) {
      renderWarranties();
    } else if (document.getElementById('detailsHeaderCard') || document.getElementById('detailsAttachmentContainer')) {
      renderWarrantyDetails();
    }
    WarrantyStore.updateSidebarBadge();
  }

  // Cross-tab real-time synchronization
  window.addEventListener('storage', (event) => {
    if (event.key === WarrantyStore.STORAGE_KEY) {
      WarrantyStore.reloadFromStorage();
      renderActivePage();
    } else if (event.key === SettingsStore.SETTINGS_KEY) {
      renderActivePage();
    }
  });

  // --------------------------------------------------------------------------
  // 10. DASHBOARD CONTROLLER (index.html)
  // --------------------------------------------------------------------------
  function renderDashboard() {
    const statTotalEl = document.getElementById('statTotal');
    if (!statTotalEl) return;

    const products = WarrantyStore.getAll();
    const statActiveEl = document.getElementById('statActive');
    const statExpiringEl = document.getElementById('statExpiring');
    const statExpiredEl = document.getElementById('statExpired');

    let activeCount = 0;
    let expiringCount = 0;
    let expiredCount = 0;

    products.forEach(p => {
      const remaining = calculateRemainingDays(p.expiryDate);
      const st = resolveWarrantyStatus(remaining);
      if (st.code === 'expired') expiredCount++;
      else if (st.code === 'expiring') expiringCount++;
      else activeCount++;
    });

    statTotalEl.textContent = products.length;
    if (statActiveEl) statActiveEl.textContent = activeCount;
    if (statExpiringEl) statExpiringEl.textContent = expiringCount;
    if (statExpiredEl) statExpiredEl.textContent = expiredCount;
    WarrantyStore.updateSidebarBadge();

    // 1. Upcoming Expirations List
    const upcomingContainer = document.getElementById('upcomingExpirationsList');
    if (upcomingContainer) {
      const upcomingList = products
        .map(p => ({
          ...p,
          remainingDays: calculateRemainingDays(p.expiryDate)
        }))
        .filter(p => p.remainingDays >= 0)
        .sort((a, b) => a.remainingDays - b.remainingDays);

      if (upcomingList.length === 0) {
        upcomingContainer.innerHTML = `
          <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <div class="empty-state-title">No Upcoming Expirations</div>
            <div class="empty-state-desc">All registered items have comfortable coverage duration or no products are recorded.</div>
            <a href="pages/add-warranty.html" class="btn btn-primary" style="margin-top: var(--space-2); padding: 4px 12px; font-size: 0.8rem;">+ Add Warranty</a>
          </div>
        `;
      } else {
        upcomingContainer.innerHTML = upcomingList.map(item => {
          const st = resolveWarrantyStatus(item.remainingDays);
          const safeName = escapeHTML(item.productName || item.name);
          const safeBrand = escapeHTML(item.brand);
          const safeCategory = escapeHTML(item.category);
          const safeAvatar = escapeHTML(item.avatar || 'PR');

          return `
            <a href="pages/warranty-details.html?id=${encodeURIComponent(item.id)}" class="upcoming-item" title="Click to view warranty details">
              <div class="upcoming-item-left">
                <div class="upcoming-avatar ${st.avatarClass}" aria-hidden="true">${safeAvatar}</div>
                <div class="upcoming-text">
                  <div class="upcoming-title">${safeName}</div>
                  <div class="upcoming-meta">
                    <span>${safeBrand}</span>
                    <span>&bull;</span>
                    <span>${safeCategory}</span>
                  </div>
                </div>
              </div>
              <div class="upcoming-item-right">
                <span class="upcoming-date">${formatDisplayDate(item.expiryDate)}</span>
                <span class="${st.chipClass}">${st.chipText}</span>
              </div>
            </a>
          `;
        }).join('');
      }
    }

    // 2. Recently Added Products Table
    const recentTableBody = document.getElementById('recentProductsTableBody');
    if (recentTableBody) {
      if (products.length === 0) {
        recentTableBody.innerHTML = `
          <tr>
            <td colspan="6">
              <div class="empty-state">
                <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                </svg>
                <div class="empty-state-title">No Registered Warranties Found</div>
                <div class="empty-state-desc">Your warranty vault is currently empty. Add your first electronic device, appliance, or receipt to get started.</div>
                <a href="pages/add-warranty.html" class="btn btn-primary" style="margin-top: var(--space-2); padding: 5px 14px; font-size: 0.8rem;">+ Register First Product</a>
              </div>
            </td>
          </tr>
        `;
      } else {
        const recentList = [...products].sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
        recentTableBody.innerHTML = recentList.map(item => {
          const rem = calculateRemainingDays(item.expiryDate);
          const st = resolveWarrantyStatus(rem);
          const priceDisplay = formatCurrencyINR(item.purchasePrice !== undefined ? item.purchasePrice : item.price);
          const hasAttachment = Boolean(item.attachment && item.attachment.id);

          const safeName = escapeHTML(item.productName || item.name);
          const safeBrand = escapeHTML(item.brand);
          const safeCategory = escapeHTML(item.category);
          const safeSerial = escapeHTML(item.serialNumber || item.serial || 'N/A');
          const safeAvatar = escapeHTML(item.avatar || 'PR');

          return `
            <tr>
              <td>
                <div class="product-cell">
                  <div class="product-avatar" aria-hidden="true">${safeAvatar}</div>
                  <div>
                    <div class="product-title">
                      ${safeName}
                      ${hasAttachment ? `<span title="Has purchase bill attachment" style="margin-left: 4px; font-size: 0.75rem; color: var(--color-primary);">&#128206;</span>` : ''}
                    </div>
                    <div class="product-category">Serial: ${safeSerial}</div>
                  </div>
                </div>
              </td>
              <td>
                <div style="font-weight: var(--font-weight-medium); color: var(--color-text-primary);">${safeCategory}</div>
                <div style="font-size: var(--font-size-xs); color: var(--color-text-muted);">${safeBrand}</div>
              </td>
              <td>${formatDisplayDate(item.purchaseDate)}</td>
              <td>${formatDisplayDate(item.expiryDate)}</td>
              <td><span class="badge ${st.badgeClass}">${st.label}</span></td>
              <td>
                <a href="pages/warranty-details.html?id=${encodeURIComponent(item.id)}" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8rem;">
                  <span>Details</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </a>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // 3. Product Categories Breakdown Grid
    const categoryGrid = document.getElementById('categorySummaryGrid');
    if (categoryGrid) {
      const categoriesMeta = {
        Electronics: {
          name: 'Electronics',
          description: 'Laptops, smartphones & displays',
          icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`
        },
        Appliances: {
          name: 'Home Appliances',
          description: 'Kitchen & living appliances',
          icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="4" y1="10" x2="20" y2="10"></line><line x1="9" y1="6" x2="9" y2="6.01"></line><line x1="9" y1="14" x2="9" y2="17"></line></svg>`
        },
        Audio: {
          name: 'Audio Equipment',
          description: 'Headphones & audio gear',
          icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>`
        },
        Accessories: {
          name: 'Accessories & Wearables',
          description: 'Smart watches & peripherals',
          icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"></circle><polyline points="12 9 12 12 13.5 13.5"></polyline><path d="M16.51 17.35l-.35 3.83a2 2 0 0 1-2 1.82H9.83a2 2 0 0 1-2-1.82l-.35-3.83m.01-10.7l.35-3.83A2 2 0 0 1 9.83 1h4.35a2 2 0 0 1 2 1.82l.35 3.83"></path></svg>`
        }
      };

      const categoryStats = {
        Electronics: { count: 0, active: 0 },
        Appliances: { count: 0, active: 0 },
        Audio: { count: 0, active: 0 },
        Accessories: { count: 0, active: 0 }
      };

      products.forEach(p => {
        const cat = (p.category || '').toLowerCase();
        let key = 'Electronics';
        if (cat.includes('applian')) key = 'Appliances';
        else if (cat.includes('audio') || cat.includes('headphone')) key = 'Audio';
        else if (cat.includes('access') || cat.includes('wear') || cat.includes('watch')) key = 'Accessories';
        else if (cat.includes('smart') || cat.includes('phone') || cat.includes('electr')) key = 'Electronics';

        if (categoryStats[key]) {
          categoryStats[key].count++;
          if (calculateRemainingDays(p.expiryDate) >= 0) {
            categoryStats[key].active++;
          }
        }
      });

      categoryGrid.innerHTML = Object.keys(categoriesMeta).map(key => {
        const meta = categoriesMeta[key];
        const stats = categoryStats[key];
        let statusPill = `<span class="badge badge-neutral">0 items</span>`;
        if (stats.count > 0) {
          if (stats.active === stats.count) {
            statusPill = `<span class="badge badge-active">${stats.active} Active</span>`;
          } else if (stats.active > 0) {
            statusPill = `<span class="badge badge-expiring">${stats.active} of ${stats.count} Valid</span>`;
          } else {
            statusPill = `<span class="badge badge-expired">Expired</span>`;
          }
        }

        return `
          <article class="category-card" aria-label="Category: ${meta.name}">
            <div class="category-card-top">
              <div class="category-icon-box" aria-hidden="true">${meta.icon}</div>
              ${statusPill}
            </div>
            <div>
              <h3 class="category-name">${meta.name}</h3>
              <div class="category-stats">
                <span class="category-count">${stats.count}</span>
                <span class="category-count-label">${stats.count === 1 ? 'Product' : 'Products'}</span>
              </div>
            </div>
            <div class="category-footer">
              <span>${meta.description}</span>
            </div>
          </article>
        `;
      }).join('');
    }
  }

  function initDashboardPage() {
    renderDashboard();
  }

  // --------------------------------------------------------------------------
  // 11. ADD & EDIT WARRANTY CONTROLLER (pages/add-warranty.html)
  // --------------------------------------------------------------------------
  function initAddWarrantyPage() {
    const form = document.getElementById('warrantyForm');
    if (!form) return;

    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('id') || urlParams.get('edit');
    const pageTitle = document.getElementById('addWarrantyPageTitle');
    const breadcrumb = document.getElementById('addWarrantyBreadcrumb');
    const saveBtnText = document.getElementById('saveBtnText');
    const successAlert = document.getElementById('formSuccessAlert');

    const inputName = document.getElementById('productName');
    const inputBrand = document.getElementById('brand');
    const selectCategory = document.getElementById('category');
    const inputSerial = document.getElementById('serialNumber');
    const inputPurchaseDate = document.getElementById('purchaseDate');
    const inputPrice = document.getElementById('purchasePrice');
    const inputDuration = document.getElementById('warrantyDuration');
    const selectUnit = document.getElementById('warrantyUnit');
    const inputNotes = document.getElementById('notes');

    const previewValue = document.getElementById('expiryPreviewValue');

    const uploadDropzone = document.getElementById('uploadDropzone');
    const invoiceFileInput = document.getElementById('invoiceFile');
    const attachmentPreviewCard = document.getElementById('attachmentPreviewCard');
    const attachmentIconBox = document.getElementById('attachmentIconBox');
    const attachmentPreviewName = document.getElementById('attachmentPreviewName');
    const attachmentPreviewMeta = document.getElementById('attachmentPreviewMeta');
    const replaceAttachmentBtn = document.getElementById('replaceAttachmentBtn');
    const removeAttachmentBtn = document.getElementById('removeAttachmentBtn');
    const errorInvoiceFile = document.getElementById('error-invoiceFile');

    let selectedFileBlob = null;
    let existingAttachmentMeta = null;
    let attachmentRemoved = false;
    let currentEditingProduct = null;

    if (editId) {
      currentEditingProduct = WarrantyStore.getById(editId);
      if (currentEditingProduct) {
        if (pageTitle) pageTitle.textContent = 'Edit Warranty Record';
        if (breadcrumb) breadcrumb.textContent = 'Edit Warranty';
        if (saveBtnText) saveBtnText.textContent = 'Update Warranty';

        inputName.value = currentEditingProduct.productName || currentEditingProduct.name || '';
        inputBrand.value = currentEditingProduct.brand || '';
        if (selectCategory) selectCategory.value = currentEditingProduct.category || '';
        inputSerial.value = currentEditingProduct.serialNumber || currentEditingProduct.serial || '';
        inputPurchaseDate.value = (currentEditingProduct.purchaseDate || '').split('T')[0];
        inputPrice.value = currentEditingProduct.purchasePrice !== undefined 
          ? currentEditingProduct.purchasePrice 
          : (parseFloat(String(currentEditingProduct.price).replace(/[^0-9.]/g, '')) || 0);
        
        inputDuration.value = currentEditingProduct.warrantyDuration || 12;
        if (selectUnit) selectUnit.value = currentEditingProduct.warrantyUnit || 'months';
        inputNotes.value = currentEditingProduct.notes || '';

        if (currentEditingProduct.attachment) {
          existingAttachmentMeta = currentEditingProduct.attachment;
          showAttachmentPreview({
            name: existingAttachmentMeta.name,
            size: existingAttachmentMeta.size,
            type: existingAttachmentMeta.type
          }, null);

          if (existingAttachmentMeta.type && existingAttachmentMeta.type.startsWith('image/')) {
            AttachmentStore.get(existingAttachmentMeta.id).then(rec => {
              if (rec && rec.blob && attachmentIconBox) {
                const objectUrl = createTrackedObjectUrl(rec.blob);
                attachmentIconBox.className = 'attachment-icon-box';
                attachmentIconBox.innerHTML = `<img src="${objectUrl}" class="attachment-thumb" alt="Thumbnail">`;
              }
            }).catch(() => {});
          }
        }
      }
    }

    function updateExpiryPreview() {
      const pDate = inputPurchaseDate.value;
      const dur = parseFloat(inputDuration.value);
      const unit = selectUnit ? selectUnit.value : 'months';

      if (!pDate || isNaN(dur) || dur <= 0) {
        previewValue.innerHTML = `<span style="color: var(--color-text-muted); font-weight: normal;">Please select purchase date and duration to preview expiry date.</span>`;
        return;
      }

      const calculatedExpiry = calculateExpiryDate(pDate, dur, unit);
      if (!calculatedExpiry) {
        previewValue.innerHTML = `<span style="color: var(--color-danger);">Invalid purchase date or duration.</span>`;
        return;
      }

      const remaining = calculateRemainingDays(calculatedExpiry);
      const st = resolveWarrantyStatus(remaining);

      previewValue.innerHTML = `
        <span>${formatDisplayDate(calculatedExpiry)}</span>
        <span class="badge ${st.badgeClass}" style="margin-left: var(--space-2);">${st.label}</span>
        <span style="font-size: var(--font-size-xs); color: var(--color-text-muted); font-weight: normal;">(${remaining >= 0 ? remaining + ' days from today' : Math.abs(remaining) + ' days ago'})</span>
      `;
    }

    inputPurchaseDate.addEventListener('input', updateExpiryPreview);
    inputDuration.addEventListener('input', updateExpiryPreview);
    if (selectUnit) selectUnit.addEventListener('change', updateExpiryPreview);
    updateExpiryPreview();

    function showAttachmentPreview(meta, fileObj) {
      if (uploadDropzone) uploadDropzone.style.display = 'none';
      if (attachmentPreviewCard) attachmentPreviewCard.style.display = 'flex';
      if (attachmentPreviewName) attachmentPreviewName.textContent = meta.name;
      
      const isPdf = (meta.type && meta.type.includes('pdf')) || meta.name.toLowerCase().endsWith('.pdf');
      const typeLabel = isPdf ? 'PDF Document' : 'Image File';
      if (attachmentPreviewMeta) {
        attachmentPreviewMeta.textContent = `${typeLabel} \u2022 ${formatFileSize(meta.size)}`;
      }

      if (attachmentIconBox) {
        if (isPdf) {
          attachmentIconBox.className = 'attachment-icon-box pdf';
          attachmentIconBox.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
          `;
        } else if (fileObj) {
          const tempUrl = createTrackedObjectUrl(fileObj);
          attachmentIconBox.className = 'attachment-icon-box';
          attachmentIconBox.innerHTML = `<img src="${tempUrl}" class="attachment-thumb" alt="Invoice Thumbnail">`;
        } else {
          attachmentIconBox.className = 'attachment-icon-box';
          attachmentIconBox.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          `;
        }
      }
    }

    function resetAttachmentUI() {
      selectedFileBlob = null;
      existingAttachmentMeta = null;
      attachmentRemoved = true;
      if (invoiceFileInput) invoiceFileInput.value = '';
      if (attachmentPreviewCard) attachmentPreviewCard.style.display = 'none';
      if (uploadDropzone) uploadDropzone.style.display = 'block';
      if (errorInvoiceFile) errorInvoiceFile.classList.remove('visible');
    }

    function handleFileSelection(file) {
      if (!file) return;

      const validMimes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      const validExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
      const fileNameLower = file.name.toLowerCase();
      const hasValidExt = validExtensions.some(ext => fileNameLower.endsWith(ext));
      const hasValidMime = validMimes.includes(file.type);

      if (!hasValidExt && !hasValidMime) {
        if (errorInvoiceFile) {
          errorInvoiceFile.textContent = 'Unsupported file format. Please upload a PDF or image (JPG, PNG, WebP).';
          errorInvoiceFile.classList.add('visible');
        }
        if (invoiceFileInput) invoiceFileInput.value = '';
        return;
      }

      const maxSizeBytes = 5 * 1024 * 1024;
      if (file.size > maxSizeBytes) {
        if (errorInvoiceFile) {
          errorInvoiceFile.textContent = `File size exceeds 5MB limit (${formatFileSize(file.size)}). Please choose a smaller file.`;
          errorInvoiceFile.classList.add('visible');
        }
        if (invoiceFileInput) invoiceFileInput.value = '';
        return;
      }

      if (errorInvoiceFile) errorInvoiceFile.classList.remove('visible');
      selectedFileBlob = file;
      attachmentRemoved = false;
      showAttachmentPreview({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream'
      }, file);
    }

    if (uploadDropzone && invoiceFileInput) {
      uploadDropzone.addEventListener('click', () => invoiceFileInput.click());
      uploadDropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          invoiceFileInput.click();
        }
      });

      uploadDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadDropzone.classList.add('dragover');
      });

      uploadDropzone.addEventListener('dragleave', () => {
        uploadDropzone.classList.remove('dragover');
      });

      uploadDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadDropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleFileSelection(e.dataTransfer.files[0]);
        }
      });

      invoiceFileInput.addEventListener('change', () => {
        if (invoiceFileInput.files && invoiceFileInput.files.length > 0) {
          handleFileSelection(invoiceFileInput.files[0]);
        }
      });
    }

    if (replaceAttachmentBtn && invoiceFileInput) {
      replaceAttachmentBtn.addEventListener('click', () => invoiceFileInput.click());
    }

    if (removeAttachmentBtn) {
      removeAttachmentBtn.addEventListener('click', resetAttachmentUI);
    }

    function setFieldError(fieldId, errorMsg) {
      const input = document.getElementById(fieldId);
      const errEl = document.getElementById(`error-${fieldId}`);
      if (input) input.classList.add('is-invalid');
      if (errEl) {
        errEl.textContent = errorMsg;
        errEl.classList.add('visible');
      }
    }

    function clearFieldError(fieldId) {
      const input = document.getElementById(fieldId);
      const errEl = document.getElementById(`error-${fieldId}`);
      if (input) input.classList.remove('is-invalid');
      if (errEl) errEl.classList.remove('visible');
    }

    function validateField(id) {
      let isValid = true;
      if (id === 'productName') {
        if (!inputName.value.trim() || inputName.value.trim().length < 2) {
          setFieldError('productName', 'Product name is required (at least 2 characters).');
          isValid = false;
        } else {
          clearFieldError('productName');
        }
      } else if (id === 'brand') {
        if (!inputBrand.value.trim()) {
          setFieldError('brand', 'Brand or manufacturer name is required.');
          isValid = false;
        } else {
          clearFieldError('brand');
        }
      } else if (id === 'category') {
        if (!selectCategory.value) {
          setFieldError('category', 'Please select a valid product category.');
          isValid = false;
        } else {
          clearFieldError('category');
        }
      } else if (id === 'purchaseDate') {
        if (!inputPurchaseDate.value) {
          setFieldError('purchaseDate', 'Purchase date is required.');
          isValid = false;
        } else {
          const selectedYear = new Date(inputPurchaseDate.value).getFullYear();
          if (selectedYear < 1990 || selectedYear > new Date().getFullYear() + 1) {
            setFieldError('purchaseDate', 'Please provide a sensible purchase date.');
            isValid = false;
          } else {
            clearFieldError('purchaseDate');
          }
        }
      } else if (id === 'purchasePrice') {
        const val = parseFloat(inputPrice.value);
        if (isNaN(val) || val < 0) {
          setFieldError('purchasePrice', 'Purchase price is required and must be a non-negative amount in INR (₹).');
          isValid = false;
        } else {
          clearFieldError('purchasePrice');
        }
      } else if (id === 'warrantyDuration') {
        const val = parseFloat(inputDuration.value);
        if (isNaN(val) || val <= 0) {
          setFieldError('warrantyDuration', 'Warranty duration is required and must be a positive number.');
          isValid = false;
        } else {
          clearFieldError('warrantyDuration');
        }
      }
      return isValid;
    }

    [inputName, inputBrand, selectCategory, inputPurchaseDate, inputPrice, inputDuration].forEach(input => {
      if (input) {
        input.addEventListener('blur', () => validateField(input.id));
        input.addEventListener('input', () => clearFieldError(input.id));
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const isNameValid = validateField('productName');
      const isBrandValid = validateField('brand');
      const isCatValid = validateField('category');
      const isDateValid = validateField('purchaseDate');
      const isPriceValid = validateField('purchasePrice');
      const isDurationValid = validateField('warrantyDuration');

      if (!isNameValid || !isBrandValid || !isCatValid || !isDateValid || !isPriceValid || !isDurationValid) {
        const firstInvalid = form.querySelector('.is-invalid');
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      const pDate = inputPurchaseDate.value;
      const dur = parseFloat(inputDuration.value);
      const unit = selectUnit ? selectUnit.value : 'months';
      const calculatedExpiry = calculateExpiryDate(pDate, dur, unit);

      let attachmentPayload = null;

      if (selectedFileBlob) {
        const newAttId = 'att-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7);
        attachmentPayload = {
          id: newAttId,
          name: selectedFileBlob.name,
          type: selectedFileBlob.type || 'application/octet-stream',
          size: selectedFileBlob.size,
          uploadedAt: new Date().toISOString()
        };

        await AttachmentStore.save({
          id: newAttId,
          productId: currentEditingProduct ? currentEditingProduct.id : null,
          name: selectedFileBlob.name,
          type: selectedFileBlob.type || 'application/octet-stream',
          size: selectedFileBlob.size,
          blob: selectedFileBlob,
          uploadedAt: attachmentPayload.uploadedAt
        });

        if (currentEditingProduct && currentEditingProduct.attachment && currentEditingProduct.attachment.id !== newAttId) {
          AttachmentStore.delete(currentEditingProduct.attachment.id).catch(() => {});
        }
      } else if (attachmentRemoved) {
        attachmentPayload = null;
        if (currentEditingProduct && currentEditingProduct.attachment && currentEditingProduct.attachment.id) {
          AttachmentStore.delete(currentEditingProduct.attachment.id).catch(() => {});
        }
      } else if (existingAttachmentMeta) {
        attachmentPayload = existingAttachmentMeta;
      }

      const productPayload = {
        productName: inputName.value,
        brand: inputBrand.value,
        category: selectCategory.value,
        serialNumber: inputSerial.value,
        purchaseDate: pDate,
        purchasePrice: parseFloat(inputPrice.value),
        warrantyDuration: dur,
        warrantyUnit: unit,
        expiryDate: calculatedExpiry,
        notes: inputNotes.value,
        attachment: attachmentPayload
      };

      if (currentEditingProduct) {
        WarrantyStore.update(currentEditingProduct.id, productPayload);
      } else {
        WarrantyStore.add(productPayload);
      }

      if (successAlert) {
        successAlert.style.display = 'flex';
        successAlert.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';
      }

      setTimeout(() => {
        window.location.href = 'warranties.html';
      }, 800);
    });
  }

  // --------------------------------------------------------------------------
  // 12. MY WARRANTIES CONTROLLER (pages/warranties.html)
  // --------------------------------------------------------------------------
  let warrantiesInitialized = false;

  function renderWarranties() {
    const tableBody = document.getElementById('warrantiesTableBody');
    const mobileCards = document.getElementById('warrantiesMobileCards');
    if (!tableBody && !mobileCards) return;

    const searchInput = document.getElementById('warrantySearchInput');
    const categoryFilter = document.getElementById('warrantyCategoryFilter');
    const statusFilter = document.getElementById('warrantyStatusFilter');
    const sortSelect = document.getElementById('warrantySortSelect');
    const countBadge = document.getElementById('warrantiesCountBadge');

    const allProducts = WarrantyStore.getAll();
    const q = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const selectedCat = categoryFilter ? categoryFilter.value : '';
    const selectedStatus = statusFilter ? statusFilter.value : '';
    const selectedSort = sortSelect ? sortSelect.value : 'expiry-asc';

    // Filter
    let filtered = allProducts.filter(item => {
      const name = (item.productName || item.name || '').toLowerCase();
      const brand = (item.brand || '').toLowerCase();
      const serial = (item.serialNumber || item.serial || '').toLowerCase();
      const cat = item.category || '';

      const matchesSearch = !q || name.includes(q) || brand.includes(q) || serial.includes(q);
      const matchesCat = !selectedCat || cat.toLowerCase() === selectedCat.toLowerCase() ||
        (selectedCat.toLowerCase() === 'electronics' && (cat.toLowerCase() === 'smartphone' || cat.toLowerCase() === 'electronics')) ||
        (selectedCat.toLowerCase().startsWith('home applian') && cat.toLowerCase().startsWith('home applian'));

      const remDays = calculateRemainingDays(item.expiryDate);
      const status = resolveWarrantyStatus(remDays);
      let matchesStatus = true;
      if (selectedStatus) {
        matchesStatus = status.code === selectedStatus;
      }

      return matchesSearch && matchesCat && matchesStatus;
    });

    // Sort
    filtered.sort((a, b) => {
      if (selectedSort === 'expiry-asc') {
        return calculateRemainingDays(a.expiryDate) - calculateRemainingDays(b.expiryDate);
      } else if (selectedSort === 'expiry-desc') {
        return calculateRemainingDays(b.expiryDate) - calculateRemainingDays(a.expiryDate);
      } else if (selectedSort === 'purchase-desc') {
        return new Date(b.purchaseDate) - new Date(a.purchaseDate);
      } else if (selectedSort === 'purchase-asc') {
        return new Date(a.purchaseDate) - new Date(b.purchaseDate);
      } else if (selectedSort === 'name-asc') {
        return (a.productName || a.name || '').localeCompare(b.productName || b.name || '');
      } else if (selectedSort === 'name-desc') {
        return (b.productName || b.name || '').localeCompare(a.productName || a.name || '');
      }
      return 0;
    });

    if (countBadge) {
      countBadge.textContent = `Showing ${filtered.length} of ${allProducts.length} items`;
    }

    if (filtered.length === 0) {
      const isFiltered = q || selectedCat || selectedStatus;
      const emptyHtml = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <div class="empty-state-title">${isFiltered ? 'No matching warranties found' : 'Your warranty vault is empty'}</div>
          <div class="empty-state-desc">${isFiltered ? 'Try clearing or modifying your search keywords and filter criteria.' : 'Register your first device or equipment to activate automated warranty tracking.'}</div>
          ${isFiltered 
            ? `<button type="button" class="btn btn-secondary" id="clearSearchFiltersBtn" style="margin-top: var(--space-2); font-size: 0.8rem;">Clear Filters</button>`
            : `<a href="add-warranty.html" class="btn btn-primary" style="margin-top: var(--space-2); font-size: 0.8rem;">+ Add Warranty</a>`
          }
        </div>
      `;

      if (tableBody) tableBody.innerHTML = `<tr><td colspan="7">${emptyHtml}</td></tr>`;
      if (mobileCards) mobileCards.innerHTML = emptyHtml;

      const clearBtn = document.getElementById('clearSearchFiltersBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          if (searchInput) searchInput.value = '';
          if (categoryFilter) categoryFilter.value = '';
          if (statusFilter) statusFilter.value = '';
          renderWarranties();
        });
      }
      return;
    }

    // Render Desktop Table
    if (tableBody) {
      tableBody.innerHTML = filtered.map(item => {
        const remDays = calculateRemainingDays(item.expiryDate);
        const st = resolveWarrantyStatus(remDays);
        const priceDisplay = formatCurrencyINR(item.purchasePrice !== undefined ? item.purchasePrice : item.price);
        const hasAttachment = Boolean(item.attachment && item.attachment.id);

        const safeName = escapeHTML(item.productName || item.name);
        const safeBrand = escapeHTML(item.brand);
        const safeCategory = escapeHTML(item.category);
        const safeSerial = escapeHTML(item.serialNumber || item.serial || 'Not Specified');
        const safeAvatar = escapeHTML(item.avatar || 'PR');

        return `
          <tr>
            <td>
              <div class="product-cell">
                <div class="product-avatar ${st.avatarClass}" aria-hidden="true">${safeAvatar}</div>
                <div>
                  <div class="product-title">
                    ${safeName}
                    ${hasAttachment ? `<span title="Has purchase invoice attachment" style="margin-left: 4px; font-size: 0.75rem; color: var(--color-primary);">&#128206;</span>` : ''}
                  </div>
                  <div class="product-category">Serial: ${safeSerial}</div>
                </div>
              </div>
            </td>
            <td>
              <div style="font-weight: var(--font-weight-medium); color: var(--color-text-primary);">${safeCategory}</div>
              <div style="font-size: var(--font-size-xs); color: var(--color-text-muted);">${safeBrand}</div>
            </td>
            <td style="font-weight: var(--font-weight-medium); color: var(--color-text-primary);">${priceDisplay}</td>
            <td>${formatDisplayDate(item.purchaseDate)}</td>
            <td>
              <div>${formatDisplayDate(item.expiryDate)}</div>
              <span class="${st.chipClass}">${st.chipText}</span>
            </td>
            <td><span class="badge ${st.badgeClass}">${st.label}</span></td>
            <td>
              <div class="table-actions">
                <a href="warranty-details.html?id=${encodeURIComponent(item.id)}" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" title="View Specs">
                  View
                </a>
                <a href="add-warranty.html?id=${encodeURIComponent(item.id)}" class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" title="Edit Product">
                  Edit
                </a>
                <button type="button" class="btn btn-danger-subtle delete-product-btn" data-id="${escapeHTML(item.id)}" style="padding: 4px 8px; font-size: 0.75rem;" title="Delete Product">
                  Delete
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // Render Mobile Cards
    if (mobileCards) {
      mobileCards.innerHTML = filtered.map(item => {
        const remDays = calculateRemainingDays(item.expiryDate);
        const st = resolveWarrantyStatus(remDays);
        const priceDisplay = formatCurrencyINR(item.purchasePrice !== undefined ? item.purchasePrice : item.price);

        const safeName = escapeHTML(item.productName || item.name);
        const safeBrand = escapeHTML(item.brand);
        const safeCategory = escapeHTML(item.category);
        const safeSerial = escapeHTML(item.serialNumber || item.serial || 'N/A');
        const safeAvatar = escapeHTML(item.avatar || 'PR');

        return `
          <div class="warranty-mobile-card">
            <div class="warranty-mobile-card-top">
              <div style="display: flex; align-items: center; gap: var(--space-3);">
                <div class="product-avatar ${st.avatarClass}" aria-hidden="true">${safeAvatar}</div>
                <div>
                  <div style="font-weight: var(--font-weight-semibold); color: var(--color-text-primary);">${safeName}</div>
                  <div style="font-size: var(--font-size-xs); color: var(--color-text-muted);">${safeBrand} &bull; ${safeCategory}</div>
                </div>
              </div>
              <span class="badge ${st.badgeClass}">${st.label}</span>
            </div>

            <div class="warranty-mobile-meta-grid">
              <div class="warranty-mobile-meta-item">
                <dt>Purchase Price</dt>
                <dd>${priceDisplay}</dd>
              </div>
              <div class="warranty-mobile-meta-item">
                <dt>Serial No.</dt>
                <dd>${safeSerial}</dd>
              </div>
              <div class="warranty-mobile-meta-item">
                <dt>Purchased</dt>
                <dd>${formatDisplayDate(item.purchaseDate)}</dd>
              </div>
              <div class="warranty-mobile-meta-item">
                <dt>Expires</dt>
                <dd>${formatDisplayDate(item.expiryDate)}</dd>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: var(--space-1); flex-wrap: wrap; gap: var(--space-2);">
              <span class="${st.chipClass}">${st.chipText}</span>
              <div class="table-actions">
                <a href="warranty-details.html?id=${encodeURIComponent(item.id)}" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;">View</a>
                <a href="add-warranty.html?id=${encodeURIComponent(item.id)}" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;">Edit</a>
                <button type="button" class="btn btn-danger-subtle delete-product-btn" data-id="${escapeHTML(item.id)}" style="padding: 4px 10px; font-size: 0.75rem;">Delete</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Attach Delete buttons via delegation
    document.querySelectorAll('.delete-product-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        const pId = btn.getAttribute('data-id');
        const target = WarrantyStore.getById(pId);
        if (target) {
          openDeleteModal(target);
        }
      };
    });
  }

  let pendingDeleteId = null;
  function openDeleteModal(product) {
    pendingDeleteId = product.id;
    const deleteModalTitle = document.getElementById('deleteProductName');
    const deleteModal = document.getElementById('deleteConfirmModal');
    if (deleteModalTitle) deleteModalTitle.textContent = `"${product.productName || product.name}"`;
    if (deleteModal) deleteModal.classList.add('active');
  }

  function closeDeleteModal() {
    pendingDeleteId = null;
    const deleteModal = document.getElementById('deleteConfirmModal');
    if (deleteModal) deleteModal.classList.remove('active');
  }

  function initWarrantiesPage() {
    const tableBody = document.getElementById('warrantiesTableBody');
    const mobileCards = document.getElementById('warrantiesMobileCards');
    if (!tableBody && !mobileCards) return;

    if (!warrantiesInitialized) {
      warrantiesInitialized = true;
      const searchInput = document.getElementById('warrantySearchInput');
      const categoryFilter = document.getElementById('warrantyCategoryFilter');
      const statusFilter = document.getElementById('warrantyStatusFilter');
      const sortSelect = document.getElementById('warrantySortSelect');
      const resetBtn = document.getElementById('resetFiltersBtn');

      if (searchInput) searchInput.addEventListener('input', renderWarranties);
      if (categoryFilter) categoryFilter.addEventListener('change', renderWarranties);
      if (statusFilter) statusFilter.addEventListener('change', renderWarranties);
      if (sortSelect) sortSelect.addEventListener('change', renderWarranties);

      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          if (searchInput) searchInput.value = '';
          if (categoryFilter) categoryFilter.value = '';
          if (statusFilter) statusFilter.value = '';
          if (sortSelect) sortSelect.value = 'expiry-asc';
          renderWarranties();
        });
      }

      const deleteModal = document.getElementById('deleteConfirmModal');
      const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
      const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
      const closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');

      if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeDeleteModal);
      if (closeDeleteModalBtn) closeDeleteModalBtn.addEventListener('click', closeDeleteModal);
      if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
          if (e.target === deleteModal) closeDeleteModal();
        });
      }

      if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', () => {
          if (pendingDeleteId) {
            WarrantyStore.delete(pendingDeleteId);
            closeDeleteModal();
            renderWarranties();
          }
        });
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && deleteModal && deleteModal.classList.contains('active')) {
          closeDeleteModal();
        }
      });
    }

    renderWarranties();
  }

  // --------------------------------------------------------------------------
  // 13. WARRANTY DETAILS CONTROLLER (pages/warranty-details.html)
  // --------------------------------------------------------------------------
  function renderWarrantyDetails() {
    const mainContent = document.getElementById('main-content');
    if (!mainContent || !window.location.pathname.includes('warranty-details')) return;

    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    const products = WarrantyStore.getAll();
    let product = null;

    if (productId) {
      product = WarrantyStore.getById(productId);
    }
    if (!product && products.length > 0) {
      product = products[0];
    }

    if (!product) {
      mainContent.innerHTML = `
        <div class="empty-state" style="padding: var(--space-8); background-color: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); margin-top: var(--space-6);">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
          <div class="empty-state-title">No Warranty Records Found</div>
          <div class="empty-state-desc">The requested warranty record does not exist or your vault is currently empty.</div>
          <a href="add-warranty.html" class="btn btn-primary" style="margin-top: var(--space-3);">+ Register a Product</a>
        </div>
      `;
      return;
    }

    const rem = calculateRemainingDays(product.expiryDate);
    const st = resolveWarrantyStatus(rem);

    // 1. Header Details
    const titleEl = document.getElementById('detailsTitle');
    if (titleEl) titleEl.textContent = product.productName || product.name;

    const brandEl = document.getElementById('detailsProductBrand');
    if (brandEl) brandEl.textContent = product.brand || '—';

    const serialEl = document.getElementById('detailsProductSerial');
    if (serialEl) serialEl.textContent = product.serialNumber || product.serial || 'Not Specified';

    const statusBadge = document.getElementById('detailsStatusBadge');
    if (statusBadge) {
      statusBadge.className = `badge ${st.badgeClass}`;
      statusBadge.textContent = st.label;
    }

    const categoryBadge = document.getElementById('detailsCategoryBadge');
    if (categoryBadge) {
      categoryBadge.textContent = product.category || 'General';
    }

    const editLink = document.getElementById('detailsEditLink');
    if (editLink) {
      editLink.setAttribute('href', `add-warranty.html?id=${encodeURIComponent(product.id)}`);
    }

    const exportBtn = document.getElementById('detailsExportPassBtn');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const passText = `=====================================================
SMART WARRANTY - OFFICIAL DIGITAL CLAIM PASS
=====================================================
Product Name:     ${product.productName || product.name}
Brand:            ${product.brand}
Category:         ${product.category}
Serial Number:    ${product.serialNumber || product.serial || 'N/A'}
Purchase Date:    ${formatDisplayDate(product.purchaseDate)}
Purchase Price:   ${formatCurrencyINR(product.purchasePrice !== undefined ? product.purchasePrice : product.price)}
Warranty Window:  ${product.warrantyDuration || 12} ${product.warrantyUnit || 'months'}
Expiration Date:  ${formatDisplayDate(product.expiryDate)}
Warranty Status:  ${st.label.toUpperCase()} (${rem >= 0 ? rem + ' days remaining' : 'Expired ' + Math.abs(rem) + ' days ago'})
Claim Hotline:    1-800-${(product.brand || 'SUPPORT').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 7)}
Coverage Notes:   ${product.notes || 'Standard manufacturer terms apply.'}
Bill Attachment:  ${product.attachment ? product.attachment.name : 'No file attached'}
Exported On:      ${new Date().toLocaleString()}
=====================================================
Engineering Mini-Project Verification Record
Smart Warranty Management System
=====================================================`;

        const blob = new Blob([passText], { type: 'text/plain;charset=utf-8' });
        const url = createTrackedObjectUrl(blob);
        const a = document.createElement('a');
        const cleanName = (product.productName || 'product').toLowerCase().replace(/[^a-z0-9]/g, '-');
        a.href = url;
        a.download = `claim-pass-${cleanName}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
    }

    // 2. Timeline Progress Bar
    const purchasedDateEl = document.getElementById('detailsPurchasedDate');
    if (purchasedDateEl) purchasedDateEl.textContent = formatDisplayDate(product.purchaseDate);

    const expiresDateEl = document.getElementById('detailsExpiresDate');
    if (expiresDateEl) expiresDateEl.textContent = formatDisplayDate(product.expiryDate);

    const statusRemainingEl = document.getElementById('detailsStatusRemaining');
    if (statusRemainingEl) {
      statusRemainingEl.textContent = `Status: ${rem >= 0 ? rem + ' Days Remaining' : 'Expired ' + Math.abs(rem) + ' Days Ago'}`;
    }

    const progressBar = document.getElementById('detailsProgressBar');
    if (progressBar) {
      const durDays = (product.durationMonths || 12) * 30;
      const progress = Math.max(0, Math.min(100, Math.round(((durDays - rem) / durDays) * 100)));
      progressBar.style.width = `${progress}%`;
      if (st.code === 'expired') {
        progressBar.style.backgroundColor = 'var(--color-danger)';
      } else if (st.code === 'expiring') {
        progressBar.style.backgroundColor = 'var(--color-warning)';
      } else {
        progressBar.style.backgroundColor = 'var(--color-primary)';
      }
    }

    // 3. Coverage Specifications
    const planTypeEl = document.getElementById('detailsPlanType');
    if (planTypeEl) planTypeEl.textContent = `${product.warrantyDuration || 12} ${product.warrantyUnit || 'Months'} Comprehensive Coverage`;

    const priceEl = document.getElementById('detailsPrice');
    if (priceEl) priceEl.textContent = formatCurrencyINR(product.purchasePrice !== undefined ? product.purchasePrice : product.price);

    const merchantEl = document.getElementById('detailsMerchant');
    if (merchantEl) merchantEl.textContent = `${product.brand} Authorized Merchant / Retail Outlet`;

    const hotlineEl = document.getElementById('detailsSupportHotline');
    if (hotlineEl) hotlineEl.textContent = `1-800-${(product.brand || 'SUPPORT').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 7)} (Official Customer Support)`;

    const notesEl = document.getElementById('detailsNotes');
    if (notesEl) notesEl.textContent = product.notes || 'Standard terms and limited warranty coverage apply.';

    // 4. Proof of Purchase Attachment
    const attachmentBadge = document.getElementById('detailsAttachmentBadge');
    const attachmentContainer = document.getElementById('detailsAttachmentContainer');
    const removeAttModal = document.getElementById('removeAttachmentModal');
    const cancelRemoveAttBtn = document.getElementById('cancelRemoveAttBtn');
    const closeRemoveAttModalBtn = document.getElementById('closeRemoveAttModalBtn');
    const confirmRemoveAttBtn = document.getElementById('confirmRemoveAttBtn');

    function closeRemoveModal() {
      if (removeAttModal) removeAttModal.classList.remove('active');
    }

    if (cancelRemoveAttBtn) cancelRemoveAttBtn.onclick = closeRemoveModal;
    if (closeRemoveAttModalBtn) closeRemoveAttModalBtn.onclick = closeRemoveModal;
    if (removeAttModal) {
      removeAttModal.onclick = (e) => {
        if (e.target === removeAttModal) closeRemoveModal();
      };
    }

    if (attachmentContainer) {
      if (product.attachment && product.attachment.id) {
        if (attachmentBadge) {
          attachmentBadge.className = 'badge badge-active';
          attachmentBadge.textContent = 'Attached Document';
        }

        attachmentContainer.innerHTML = `
          <div style="text-align: center; padding: var(--space-4); color: var(--color-text-muted); font-size: var(--font-size-sm);">
            Loading document from browser IndexedDB...
          </div>
        `;

        AttachmentStore.get(product.attachment.id).then(record => {
          if (!record || !record.blob) {
            if (attachmentBadge) {
              attachmentBadge.className = 'badge badge-expiring';
              attachmentBadge.textContent = 'Metadata Only';
            }
            attachmentContainer.innerHTML = `
              <div style="border: 1px dashed var(--color-warning); border-radius: var(--radius-md); padding: var(--space-4); background-color: var(--color-warning-bg); text-align: center;">
                <p style="font-size: var(--font-size-sm); color: var(--color-warning); font-weight: var(--font-weight-medium);">
                  Invoice metadata reference exists (${escapeHTML(product.attachment.name)}), but the file was removed from browser IndexedDB storage.
                </p>
                <div style="margin-top: var(--space-3); display: flex; justify-content: center; gap: var(--space-2); flex-wrap: wrap;">
                  <a href="add-warranty.html?id=${encodeURIComponent(product.id)}" class="btn btn-secondary" style="font-size: 0.75rem;">Re-Upload Bill</a>
                  <button type="button" class="btn btn-danger-subtle" id="cleanMissingAttBtn" style="font-size: 0.75rem;">Remove Reference</button>
                </div>
              </div>
            `;
            const cleanBtn = document.getElementById('cleanMissingAttBtn');
            if (cleanBtn) {
              cleanBtn.onclick = () => {
                WarrantyStore.update(product.id, { ...product, attachment: null });
                renderWarrantyDetails();
              };
            }
            return;
          }

          const isPdf = (record.type && record.type.includes('pdf')) || record.name.toLowerCase().endsWith('.pdf');
          const isImage = (record.type && record.type.startsWith('image/')) || (!isPdf);
          const objectUrl = createTrackedObjectUrl(record.blob);

          attachmentContainer.innerHTML = `
            <div class="details-attachment-box">
              <div class="details-attachment-left">
                <div class="attachment-icon-box ${isPdf ? 'pdf' : ''}">
                  ${isPdf ? `
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                  ` : `
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <circle cx="8.5" cy="8.5" r="1.5"></circle>
                      <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                  `}
                </div>
                <div class="attachment-info">
                  <div class="attachment-name" title="${escapeHTML(record.name)}">${escapeHTML(record.name)}</div>
                  <div class="attachment-meta">
                    ${isPdf ? 'PDF Document' : 'Image File'} &bull; ${formatFileSize(record.size)} &bull; Uploaded ${formatDisplayDate(record.uploadedAt)}
                  </div>
                </div>
              </div>
              <div class="attachment-actions">
                <button type="button" class="btn btn-secondary" id="viewBillBtn" style="font-size: 0.75rem; padding: 4px 10px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  <span>View Bill</span>
                </button>
                <button type="button" class="btn btn-secondary" id="downloadBillBtn" style="font-size: 0.75rem; padding: 4px 10px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  <span>Download</span>
                </button>
                <button type="button" class="btn btn-danger-subtle" id="removeBillBtn" style="font-size: 0.75rem; padding: 4px 10px;">
                  Remove
                </button>
              </div>
            </div>

            ${isImage ? `
              <div class="details-attachment-image-preview">
                <img src="${objectUrl}" alt="Invoice Proof Preview" id="detailsPreviewImg">
                <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: var(--space-2);">
                  Click image or "View Bill" to inspect in full resolution
                </div>
              </div>
            ` : ''}
          `;

          const viewBtn = document.getElementById('viewBillBtn');
          if (viewBtn) {
            viewBtn.onclick = () => window.open(objectUrl, '_blank');
          }

          const previewImg = document.getElementById('detailsPreviewImg');
          if (previewImg) {
            previewImg.onclick = () => window.open(objectUrl, '_blank');
          }

          const downloadBtn = document.getElementById('downloadBillBtn');
          if (downloadBtn) {
            downloadBtn.onclick = () => {
              const a = document.createElement('a');
              a.href = objectUrl;
              a.download = record.name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            };
          }

          const removeBtn = document.getElementById('removeBillBtn');
          if (removeBtn) {
            removeBtn.onclick = () => {
              if (removeAttModal) removeAttModal.classList.add('active');
            };
          }

          if (confirmRemoveAttBtn) {
            confirmRemoveAttBtn.onclick = () => {
              AttachmentStore.delete(product.attachment.id).then(() => {
                WarrantyStore.update(product.id, { ...product, attachment: null });
                closeRemoveModal();
                renderWarrantyDetails();
              });
            };
          }
        }).catch(err => {
          console.warn('Error fetching attachment blob:', err);
        });
      } else {
        if (attachmentBadge) {
          attachmentBadge.className = 'badge badge-neutral';
          attachmentBadge.textContent = 'No Attachment';
        }
        attachmentContainer.innerHTML = `
          <div style="border: 1px dashed var(--color-border); border-radius: var(--radius-md); padding: var(--space-6); text-align: center; background-color: var(--color-bg);">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--color-text-muted); margin: 0 auto var(--space-2);">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="12" y1="18" x2="12" y2="12"></line>
              <line x1="9" y1="15" x2="15" y2="15"></line>
            </svg>
            <p style="font-size: var(--font-size-sm); color: var(--color-text-muted); margin-bottom: var(--space-3);">
              No purchase bill or invoice attached to this warranty record.
            </p>
            <a href="add-warranty.html?id=${encodeURIComponent(product.id)}" class="btn btn-secondary" style="font-size: var(--font-size-xs); padding: 5px 12px;">
              <span>+ Attach Purchase Invoice</span>
            </a>
          </div>
        `;
      }
    }
  }

  function initWarrantyDetailsPage() {
    renderWarrantyDetails();
  }

  // --------------------------------------------------------------------------
  // 14. SETTINGS & CLIENT DATA MANAGEMENT CONTROLLER (pages/settings.html)
  // --------------------------------------------------------------------------
  let settingsInitialized = false;

  function initSettingsPage() {
    const exportBtn = document.getElementById('exportDataBtn');
    const importBtn = document.getElementById('importDataBtn');
    const importFileInput = document.getElementById('importFileInput');
    const resetDemoBtn = document.getElementById('resetDemoBtn');
    const clearAllDataBtn = document.getElementById('clearAllDataBtn');
    const settingsAlert = document.getElementById('settingsAlert');
    const settingsAlertText = document.getElementById('settingsAlertText');

    const expiryThresholdSelect = document.getElementById('expiryThreshold');
    const dateFormatSelect = document.getElementById('dateFormat');

    const settingsModal = document.getElementById('settingsConfirmModal');
    const settingsModalTitle = document.getElementById('settingsModalTitle');
    const settingsModalMessage = document.getElementById('settingsModalMessage');
    const settingsModalSubMessage = document.getElementById('settingsModalSubMessage');
    const confirmSettingsModalBtn = document.getElementById('confirmSettingsModalBtn');
    const cancelSettingsModalBtn = document.getElementById('cancelSettingsModalBtn');
    const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');

    if (!exportBtn && !resetDemoBtn && !clearAllDataBtn) return;

    // Load saved preferences into form controls
    const savedPreferences = SettingsStore.getSettings();
    if (expiryThresholdSelect && savedPreferences.expiryThreshold) {
      expiryThresholdSelect.value = String(savedPreferences.expiryThreshold);
    }
    if (dateFormatSelect && savedPreferences.dateFormat) {
      dateFormatSelect.value = savedPreferences.dateFormat;
    }

    if (settingsInitialized) return;
    settingsInitialized = true;

    let pendingAction = null; // 'reset', 'clear', or 'import'
    let pendingImportFileText = null;
    let pendingImportSummary = null;

    function showAlert(message, isSuccess = true) {
      if (!settingsAlert || !settingsAlertText) return;
      settingsAlertText.textContent = message;
      settingsAlert.className = isSuccess ? 'alert alert-success' : 'alert alert-warning';
      settingsAlert.style.display = 'flex';
      setTimeout(() => {
        settingsAlert.style.display = 'none';
      }, 5000);
    }

    function openSettingsModal(action, extraData = null) {
      pendingAction = action;
      if (action === 'reset') {
        if (settingsModalTitle) settingsModalTitle.textContent = 'Reset Demonstration Data';
        if (settingsModalMessage) {
          settingsModalMessage.textContent = 'Are you sure you want to restore the 4 default demonstration warranty products?';
        }
        if (settingsModalSubMessage) {
          settingsModalSubMessage.textContent = 'Any custom warranties added will be replaced with standard college viva demonstration records.';
          settingsModalSubMessage.style.color = 'var(--color-text-secondary)';
        }
        if (confirmSettingsModalBtn) {
          confirmSettingsModalBtn.textContent = 'Reset Demo Records';
          confirmSettingsModalBtn.className = 'btn btn-primary';
          confirmSettingsModalBtn.style.backgroundColor = '';
          confirmSettingsModalBtn.style.borderColor = '';
        }
      } else if (action === 'clear') {
        if (settingsModalTitle) settingsModalTitle.textContent = 'Clear All Warranty Records';
        if (settingsModalMessage) {
          settingsModalMessage.textContent = 'Are you sure you want to permanently erase all warranty records and attached bills?';
        }
        if (settingsModalSubMessage) {
          settingsModalSubMessage.textContent = 'This action cannot be undone. All LocalStorage records and IndexedDB attachments will be deleted.';
          settingsModalSubMessage.style.color = 'var(--color-danger)';
        }
        if (confirmSettingsModalBtn) {
          confirmSettingsModalBtn.textContent = 'Clear All Data';
          confirmSettingsModalBtn.className = 'btn btn-primary';
          confirmSettingsModalBtn.style.backgroundColor = 'var(--color-danger)';
          confirmSettingsModalBtn.style.borderColor = 'var(--color-danger)';
        }
      } else if (action === 'import' && extraData) {
        if (settingsModalTitle) settingsModalTitle.textContent = 'Confirm Backup Import';
        if (settingsModalMessage) {
          settingsModalMessage.textContent = `Are you sure you want to import ${extraData.recordCount} warranty records? This will replace your current storage.`;
        }
        if (settingsModalSubMessage) {
          settingsModalSubMessage.textContent = extraData.attachmentCount > 0 
            ? `Includes ${extraData.attachmentCount} purchase bill attachments that will be restored to IndexedDB.`
            : 'Note: This backup file contains product metadata only (no binary bill attachments).';
          settingsModalSubMessage.style.color = 'var(--color-text-secondary)';
        }
        if (confirmSettingsModalBtn) {
          confirmSettingsModalBtn.textContent = 'Import & Replace';
          confirmSettingsModalBtn.className = 'btn btn-primary';
          confirmSettingsModalBtn.style.backgroundColor = '';
          confirmSettingsModalBtn.style.borderColor = '';
        }
      }
      if (settingsModal) settingsModal.classList.add('active');
    }

    function closeSettingsModal() {
      pendingAction = null;
      pendingImportFileText = null;
      pendingImportSummary = null;
      if (settingsModal) settingsModal.classList.remove('active');
    }

    if (cancelSettingsModalBtn) cancelSettingsModalBtn.onclick = closeSettingsModal;
    if (closeSettingsModalBtn) closeSettingsModalBtn.onclick = closeSettingsModal;
    if (settingsModal) {
      settingsModal.onclick = (e) => {
        if (e.target === settingsModal) closeSettingsModal();
      };
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && settingsModal && settingsModal.classList.contains('active')) {
        closeSettingsModal();
      }
    });

    if (confirmSettingsModalBtn) {
      confirmSettingsModalBtn.onclick = async () => {
        if (pendingAction === 'reset') {
          WarrantyStore.resetDemo();
          closeSettingsModal();
          showAlert('Demonstration storage restored successfully (4 demo products loaded).', true);
        } else if (pendingAction === 'clear') {
          WarrantyStore.clearAll();
          closeSettingsModal();
          showAlert('All warranty records and invoice attachments cleared from browser storage.', true);
        } else if (pendingAction === 'import' && pendingImportFileText) {
          try {
            const res = await WarrantyStore.importBackup(pendingImportFileText);
            closeSettingsModal();
            const attNote = res.attachmentCount > 0 ? ` and ${res.attachmentCount} bill attachments` : '';
            showAlert(`Successfully restored ${res.recordCount} warranty records${attNote}.`, true);
          } catch (err) {
            closeSettingsModal();
            showAlert(`Import failed: ${err.message}`, false);
          }
        }
      };
    }

    if (resetDemoBtn) {
      resetDemoBtn.onclick = () => openSettingsModal('reset');
    }

    if (clearAllDataBtn) {
      clearAllDataBtn.onclick = () => openSettingsModal('clear');
    }

    // Expiration threshold selection change
    if (expiryThresholdSelect) {
      expiryThresholdSelect.onchange = () => {
        const val = parseInt(expiryThresholdSelect.value, 10);
        SettingsStore.saveSettings({ expiryThreshold: val });
        showAlert(`Alert window updated to ${val} days. All status badges updated.`, true);
      };
    }

    if (dateFormatSelect) {
      dateFormatSelect.onchange = () => {
        SettingsStore.saveSettings({ dateFormat: dateFormatSelect.value });
        showAlert(`Preferred date format saved: ${dateFormatSelect.value}`, true);
      };
    }

    // Export Data (JSON Bundle with attachments)
    if (exportBtn) {
      exportBtn.onclick = async () => {
        try {
          const originalText = exportBtn.querySelector('span')?.textContent;
          if (exportBtn.querySelector('span')) exportBtn.querySelector('span').textContent = 'Packaging Backup...';

          const backupJson = await WarrantyStore.exportBackup();
          const blob = new Blob([backupJson], { type: 'application/json;charset=utf-8' });
          const url = createTrackedObjectUrl(blob);
          const a = document.createElement('a');
          const dateTag = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `smart-warranty-backup-${dateTag}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          if (exportBtn.querySelector('span') && originalText) exportBtn.querySelector('span').textContent = originalText;
          showAlert('Complete warranty backup exported successfully (including attached bills).', true);
        } catch (err) {
          showAlert(`Export error: ${err.message}`, false);
        }
      };
    }

    // Import Data with Confirmation Safeguard
    if (importBtn && importFileInput) {
      importBtn.onclick = () => importFileInput.click();

      importFileInput.onchange = () => {
        if (importFileInput.files && importFileInput.files.length > 0) {
          const file = importFileInput.files[0];
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const fileContent = e.target.result;
              const parsed = JSON.parse(fileContent);

              let recCount = 0;
              let attCount = 0;

              if (parsed && typeof parsed === 'object' && Array.isArray(parsed.records)) {
                recCount = parsed.records.length;
                attCount = Array.isArray(parsed.attachments) ? parsed.attachments.length : 0;
              } else if (Array.isArray(parsed)) {
                recCount = parsed.length;
                attCount = 0;
              } else {
                throw new Error('Unsupported backup format. File must contain an array of records or a valid backup bundle.');
              }

              pendingImportFileText = fileContent;
              pendingImportSummary = { recordCount: recCount, attachmentCount: attCount };
              openSettingsModal('import', pendingImportSummary);
            } catch (err) {
              showAlert(`Import failed: ${err.message}`, false);
            }
            importFileInput.value = '';
          };
          reader.onerror = () => {
            showAlert('Failed to read selected backup file.', false);
            importFileInput.value = '';
          };
          reader.readAsText(file);
        }
      };
    }
  }

  // --------------------------------------------------------------------------
  // 15. PAGE INITIALIZATION ROUTER
  // --------------------------------------------------------------------------
  initDashboardPage();
  initAddWarrantyPage();
  initWarrantiesPage();
  initWarrantyDetailsPage();
  initSettingsPage();

  // Expose global developer & viva demonstration testing API
  window.smartWarranty = {
    store: WarrantyStore,
    attachments: AttachmentStore,
    settings: SettingsStore,
    calculateExpiryDate,
    calculateRemainingDays,
    resolveWarrantyStatus,
    formatDisplayDate,
    formatCurrencyINR,
    formatFileSize,
    escapeHTML,
    exportBackup: () => WarrantyStore.exportBackup(),
    importBackup: (json) => WarrantyStore.importBackup(json),
    resetDemo: () => {
      WarrantyStore.resetDemo();
      window.location.reload();
    },
    clearAll: () => {
      WarrantyStore.clearAll();
      window.location.reload();
    }
  };

  console.log('Smart Warranty System: Unified Engine & UI Controllers v1.0 Ready.');
});
