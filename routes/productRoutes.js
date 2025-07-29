const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authorizeMiddleware');
const checkBranchAccess = require('../middleware/checkBranchAccess');
const uploadExcel = require('../middleware/uploadExcelMiddleware');
const upload = require('../middleware/uploadMiddleware');

// --- Export/Import Excel ---
router.get('/export', protect, authorize('access_app_ql_sanpham'), productController.exportProducts);
router.post(
    '/import',
    protect,
    authorize('access_app_ql_sanpham'),
    uploadExcel.single('file'),
    productController.importProducts
);

// --- Dropdown danh mục & chi nhánh ---
router.get('/categories-list', protect, productController.getCategoriesList);
router.get('/branches', protect, productController.getBranchesList);

// --- Lấy sản phẩm theo chi nhánh ---
router.get(
    '/branch/:branch_id',
    protect,
    authorize('view_app_ql_sanpham'),
    checkBranchAccess,
    productController.getByBranch
);

// --- Lấy tất cả sản phẩm ---
router.get(
    '/',
    protect,
    authorize('view_app_ql_sanpham', 'access_app_ql_sanpham'),
    productController.index
);

// --- Chi tiết sản phẩm ---
router.get('/:id', protect, authorize('view_app_ql_sanpham'), productController.show);

// --- Tạo sản phẩm mới ---
router.post(
    '/',
    protect,
    authorize('create_app_ql_sanpham'),
    checkBranchAccess,
    upload.single('image_file'),
    productController.store
);

// --- Cập nhật sản phẩm ---
router.put(
    '/:id',
    protect,
    authorize('edit_app_ql_sanpham', 'access_app_ql_sanpham'),
    checkBranchAccess,
    upload.single('image_file'),
    productController.update
);

// --- Xóa sản phẩm ---
router.delete(
    '/:id',
    protect,
    authorize('delete_app_ql_sanpham'),
    checkBranchAccess,
    productController.destroy
);

module.exports = router;
