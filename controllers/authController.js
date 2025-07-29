// my-library-app-backend/controllers/authController.js

const bcrypt = require('bcryptjs'); // Để băm và so sánh mật khẩu
const jwt = require('jsonwebtoken'); // Để tạo và xác thực JWT
const { pool } = require('../config/db'); // Sửa đổi dòng này!

// Hàm tạo JWT token
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN,
    });
};

// Hàm xử lý đăng ký người dùng mới
const register = async (req, res) => {
    const { name, email, password } = req.body;

    // Kiểm tra dữ liệu đầu vào
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ tất cả các trường.' });
    }

    try {
        // Kiểm tra xem email đã tồn tại chưa
        const [existingUser] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: 'Email đã tồn tại.' });
        }

        // Băm mật khẩu
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Lưu người dùng vào database
        const [result] = await pool.execute(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );

        const newUser = {
            id: result.insertId,
            name,
            email,
        };

        // Tạo JWT token và gửi về client
        res.status(201).json({
            message: 'Đăng ký thành công!',
            user: newUser,
            token: generateToken(newUser.id),
        });

    } catch (error) {
        console.error('Lỗi khi đăng ký người dùng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi đăng ký.' });
    }
};

// Hàm xử lý đăng nhập người dùng
const login = async (req, res) => {
    const { email, password } = req.body;

    // Kiểm tra dữ liệu đầu vào
    if (!email || !password) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ email và mật khẩu.' });
    }

    try {
        // Tìm người dùng theo email
        const [users] = await pool.execute('SELECT id, name, email, password, active FROM users WHERE email = ?', [email]);
        const user = users[0];

        // Kiểm tra người dùng có tồn tại và mật khẩu có đúng không
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: 'Email hoặc mật khẩu không chính xác.' });
        }

        // Kiểm tra trạng thái active của người dùng
        if (!user.active) {
            return res.status(403).json({ message: 'Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.' });
        }

        // Tạo JWT token và gửi về client
        res.status(200).json({
            message: 'Đăng nhập thành công!',
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                active: user.active,
            },
            token: generateToken(user.id),
        });

    } catch (error) {
        console.error('Lỗi khi đăng nhập người dùng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi đăng nhập.' });
    }
};

const getMe = async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Người dùng chưa được xác thực.' });
    }

    try {
        const [users] = await pool.execute('SELECT id, name, email, active FROM users WHERE id = ?', [req.user.id]);
        const user = users[0];

        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
        }

        // Lấy roles và permissions
        const [userRolesPermissions] = await pool.execute(`
            SELECT
                r.id AS role_id,
                r.name AS role_name,
                p.name AS permission_name
            FROM users u
            JOIN model_has_roles mhr 
                ON u.id = mhr.model_id 
                AND mhr.model_type = 'App\\\\\\\\Models\\\\\\\\User'
            JOIN roles r ON mhr.role_id = r.id
            LEFT JOIN role_has_permissions rhp ON r.id = rhp.role_id
            LEFT JOIN permissions p ON rhp.permission_id = p.id
            WHERE u.id = ?
        `, [user.id]);

        const rolesMap = new Map();
        userRolesPermissions.forEach(row => {
            if (row.role_id && row.role_name) {
                rolesMap.set(row.role_id, { id: row.role_id, name: row.role_name });
            }
        });
        const roles = Array.from(rolesMap.values());

        const permissions = [...new Set(
            userRolesPermissions
                .filter(row => row.permission_name)
                .map(row => row.permission_name)
        )];

        // Lấy thông tin branches (chi nhánh) của user
        const [branches] = await pool.execute(`
            SELECT b.id, b.name 
            FROM branch_user bu
            JOIN branches b ON bu.branch_id = b.id
            WHERE bu.user_id = ?
        `, [user.id]);

        // Trả về cả branch ids (mảng id) và chi nhánh chi tiết (nếu cần)
        const branch_ids = branches.map(b => b.id);

        res.status(200).json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                active: user.active,
                roles: roles,
                branches: branches,       // chi nhánh chi tiết nếu cần
                branch_ids: branch_ids,   // mảng id chi nhánh để dùng frontend dễ
            },
            permissions: permissions,
        });

    } catch (error) {
        console.error('❌ Lỗi khi lấy thông tin người dùng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi lấy thông tin người dùng.' });
    }
};



// Xuất tất cả các hàm xử lý
module.exports = {
    register,
    login,
    getMe,
};
