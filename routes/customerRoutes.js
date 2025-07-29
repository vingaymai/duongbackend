const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authorizeMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Cấu hình Multer để lưu file Excel tạm thời
const uploadExcel = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '../uploads/excel');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Chỉ cho phép file Excel (.xlsx hoặc .xls)!'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // Giới hạn 5MB
});

// 👉 Lấy danh sách chi nhánh (cho dropdown filter và form)
router.get(
  '/branches',
  protect,
  authorize('access_app_ql_khachhang'),
  customerController.getBranchesList
);

// 👉 Lấy danh sách khách hàng
router.get(
  '/',
  protect,
  authorize('view_app_ql_khachhang'),
  customerController.index
);

// 👉 Lấy chi tiết khách hàng theo ID
router.get(
  '/:id',
  protect,
  authorize('view_app_ql_khachhang'),
  customerController.show
);

// 👉 Tạo khách hàng mới
router.post(
  '/',
  protect,
  authorize('create_app_ql_khachhang'),
  customerController.store
);

// 👉 Cập nhật khách hàng theo ID
router.put(
  '/:id',
  protect,
  authorize('edit_app_ql_khachhang'),
  customerController.update
);

// 👉 Xóa khách hàng theo ID
router.delete(
  '/:id',
  protect,
  authorize('delete_app_ql_khachhang'),
  customerController.destroy
);

// 👉 Export khách hàng ra file Excel
router.get(
  '/export',
  protect,
  authorize('export_app_ql_khachhang'),
  customerController.exportCustomers
);

// 👉 Import khách hàng từ file Excel
router.post(
  '/import',
  protect,
  authorize('import_app_ql_khachhang'),
  uploadExcel.single('file'),
  customerController.importCustomers
);

module.exports = router;
