// duongbackend/controllers/permissionController.js

const { pool } = require('../config/db');

// Hàm xử lý lấy danh sách quyền hạn
const index = async (req, res) => {
    try {
        const [permissions] = await pool.execute('SELECT id, name, description FROM permissions ORDER BY name ASC');
        res.json(permissions);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách quyền hạn:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi lấy danh sách quyền hạn.' });
    }
};

// Xuất tất cả các hàm xử lý
module.exports = {
    index,
};
