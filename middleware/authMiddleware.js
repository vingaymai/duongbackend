const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

// Middleware để bảo vệ các route
const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            const [users] = await pool.execute('SELECT id, name, email, active FROM users WHERE id = ?', [decoded.id]);
            const user = users[0];

            if (!user) {
                return res.status(401).json({ message: 'Không được ủy quyền, người dùng không tồn tại.' });
            }

            // Lấy vai trò và quyền
            const [userRolesPermissions] = await pool.execute(`
                SELECT
                    r.id AS role_id,
                    r.name AS role_name,
                    p.name AS permission_name
                FROM users u
                JOIN model_has_roles mhr ON u.id = mhr.model_id AND mhr.model_type = 'App\\\\\\\\Models\\\\\\\\User'
                JOIN roles r ON mhr.role_id = r.id
                LEFT JOIN role_has_permissions rhp ON r.id = rhp.role_id
                LEFT JOIN permissions p ON rhp.permission_id = p.id
                WHERE u.id = ?
            `, [user.id]);

            // Gán roles và permissions
            const roles = userRolesPermissions.map(row => row.role_name);
            const permissions = [...new Set(userRolesPermissions.map(row => row.permission_name.trim()))];

            // Kiểm tra nếu không có quyền hoặc vai trò
            if (permissions.length === 0) {
                return res.status(403).json({ message: 'User does not have any permissions.' });
            }
            if (roles.length === 0) {
                return res.status(403).json({ message: 'User does not have any roles.' });
            }

            // Lấy danh sách chi nhánh mà user có quyền truy cập
            const [branches] = await pool.execute(`
                SELECT branch_id FROM branch_user WHERE user_id = ?
            `, [user.id]);

            const branch_ids = branches.map(row => row.branch_id);

            req.user = {
                id: user.id,
                name: user.name,
                email: user.email,
                active: user.active,
                roles,
                permissions,
                branch_ids
            };

            next();
        } catch (error) {
            console.error('Lỗi xác thực token:', error);
            return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
        }
    } else {
        return res.status(401).json({ message: 'Không được ủy quyền, không có token.' });
    }
};

module.exports = { protect };
