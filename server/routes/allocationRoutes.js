const express = require('express');
const router = express.Router();
const {
  generateAllocation,
  regenerateAllocation,
  getCurrentAllocation,
  getAllocationVersions,
  verifyAllocation,
  lockAllocation,
  publishAllocation,
  unlockAllocation,
} = require('../controllers/allocationController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Seating and Question Paper Allocation Endpoints (Supports both /:id/allocate and /allocate)
router.post('/allocate', generateAllocation);
router.post('/:id/allocate', generateAllocation);

router.post('/regenerate', regenerateAllocation);
router.post('/:id/regenerate', regenerateAllocation);

// Single & Multiple Allocation Retrieval (Supports /allocation and /allocations)
router.get('/allocation', getCurrentAllocation);
router.get('/allocations', getCurrentAllocation);
router.get('/:id/allocation', getCurrentAllocation);
router.get('/:id/allocations', getCurrentAllocation);

// Version History
router.get('/allocation/versions', getAllocationVersions);
router.get('/allocations/versions', getAllocationVersions);
router.get('/:id/allocation/versions', getAllocationVersions);
router.get('/:id/allocations/versions', getAllocationVersions);

// Verification, Locking, and Publishing
router.post('/verify', verifyAllocation);
router.post('/:id/verify', verifyAllocation);

router.post('/lock', lockAllocation);
router.post('/:id/lock', lockAllocation);

router.post('/publish', authorize('admin'), publishAllocation);
router.post('/:id/publish', authorize('admin'), publishAllocation);

router.post('/unlock', unlockAllocation);
router.post('/:id/unlock', unlockAllocation);

module.exports = router;
