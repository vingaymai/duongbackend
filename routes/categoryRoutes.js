const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
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
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// ✅ Route definitions

// 👉 Lấy tất cả danh mục
router.get(
    '/',
    protect,
    authorize('access_app_ql_danhmuc_sanpham'),
    categoryController.index
);

// 👉 Lấy danh sách danh mục cha (cho dropdown)
router.get(
    '/parents',
    protect,
    authorize('view_app_ql_danhmuc_sanpham'),
    categoryController.getParentCategories
);

// 👉 Lấy danh mục theo ID
router.get(
    '/:id',
    protect,
    authorize('view_app_ql_danhmuc_sanpham'),
    categoryController.getCategoryById
);

// 👉 Tạo danh mục mới
router.post(
    '/',
    protect,
    authorize('create_app_ql_danhmuc_sanpham'),
    categoryController.createCategory
);

// 👉 Cập nhật danh mục
router.put(
    '/:id',
    protect,
    authorize('edit_app_ql_danhmuc_sanpham'),
    categoryController.updateCategory
);

// 👉 Xóa danh mục
router.delete(
    '/:id',
    protect,
    authorize('delete_app_ql_danhmuc_sanpham'),
    categoryController.deleteCategory
);

// 👉 Export danh mục ra Excel
router.get(
    '/export',
    protect,
    authorize('export_app_ql_danhmuc_sanpham'),
    categoryController.exportCategories
);

// 👉 Import danh mục từ Excel
router.post(
    '/import',
    protect,
    authorize('import_app_ql_danhmuc_sanpham'),
    uploadExcel.single('file'),
    categoryController.importCategories
);

module.exports = router;
