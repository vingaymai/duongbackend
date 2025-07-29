// duongbackend/routes/generateCrudRoutes.js
const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authorizeMiddleware');

/**
 * Tự động tạo route CRUD với phân quyền đầy đủ
 * @param {string} resourceName - ví dụ: 'users', 'branches', 'categories'
 * @param {string} appPermission - ví dụ: 'ql_nguoidung', 'ql_chinhanh', ...
 * @param {object} controller - object chứa các hàm: index, show, store, update, destroy
 * @returns {Router}
 */
function generateCrudRoutes(resourceName, appPermission, controller) {
    const router = express.Router();
    const resource = resourceName.toLowerCase();

    router.use(protect); // bảo vệ toàn bộ route

    router.get('/', authorize(`view_${resource}`, `access_app_${appPermission}`), controller.index);
    router.get('/:id', authorize(`view_${resource}`), controller.show);
    router.post('/', authorize(`create_${resource}`), controller.store);
    router.put('/:id', authorize(`edit_${resource}`), controller.update);
    router.delete('/:id', authorize(`delete_${resource}`), controller.destroy);

    return router;
}

module.exports = generateCrudRoutes;
