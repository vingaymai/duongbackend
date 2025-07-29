// my-library-app-backend/seeders/rolesPermissionsSeeder.js

const pool = require('../config/db'); // Import pool kết nối database
const bcrypt = require('bcryptjs'); // Để băm mật khẩu cho người dùng admin

async function seedRolesAndPermissions() {
    try {
        console.log('--- Bắt đầu quá trình seeding Roles và Permissions ---');

        // Tạo các quyền hạn (Permissions)
        const permissionsToCreate = [
            // Quyền quản lý người dùng
            'view users', 'create users', 'edit users', 'delete users',
            // Quyền quản lý vai trò
            'view roles', 'create roles', 'edit roles', 'delete roles', 'assign roles', 'assign permissions to roles',
            // Quyền truy cập ứng dụng (tương tự như Laravel của bạn)
            'access_app_sales',
            'access_app_ql_sanpham',
            'access_app_ql_danhmuc_sanpham',
            'access_app_ql_chinhanh',
            'access_app_ql_khachhang',
            'access_app_ql_nguoidung',
            'access_app_ql_donhang',
            'access_app_baocaothongke',
            // Thêm các quyền khác nếu cần
        ];

        const createdPermissions = {}; // Để lưu trữ ID của các quyền đã tạo
        for (const permName of permissionsToCreate) {
            const [result] = await pool.execute(
                'INSERT IGNORE INTO permissions (name, description) VALUES (?, ?)',
                [permName, `Quyền ${permName}`]
            );
            if (result.affectedRows > 0) {
                console.log(`Đã tạo quyền: ${permName}`);
                // Lấy ID của quyền vừa tạo hoặc đã tồn tại
                const [perm] = await pool.execute('SELECT id FROM permissions WHERE name = ?', [permName]);
                createdPermissions[permName] = perm[0].id;
            } else {
                // Nếu quyền đã tồn tại, lấy ID của nó
                const [perm] = await pool.execute('SELECT id FROM permissions WHERE name = ?', [permName]);
                createdPermissions[permName] = perm[0].id;
            }
        }

        // Tạo các vai trò (Roles)
        // Vai trò Admin
        const [adminRoleResult] = await pool.execute(
            'INSERT IGNORE INTO roles (name, description) VALUES (?, ?)',
            ['Admin', 'Quản trị viên toàn hệ thống']
        );
        const [adminRole] = await pool.execute('SELECT id FROM roles WHERE name = ?', ['Admin']);
        const adminRoleId = adminRole[0].id;
        if (adminRoleResult.affectedRows > 0) {
            console.log('Đã tạo vai trò: Admin');
        }

        // Vai trò Member (Thành viên/Khách hàng)
        const [memberRoleResult] = await pool.execute(
            'INSERT IGNORE INTO roles (name, description) VALUES (?, ?)',
            ['Member', 'Người dùng thông thường']
        );
        const [memberRole] = await pool.execute('SELECT id FROM roles WHERE name = ?', ['Member']);
        const memberRoleId = memberRole[0].id;
        if (memberRoleResult.affectedRows > 0) {
            console.log('Đã tạo vai trò: Member');
        }

        // Gán tất cả các quyền cho vai trò Admin
        const adminPermissions = Object.values(createdPermissions); // Lấy tất cả ID quyền
        for (const permId of adminPermissions) {
            await pool.execute(
                'INSERT IGNORE INTO role_has_permissions (role_id, permission_id) VALUES (?, ?)',
                [adminRoleId, permId]
            );
        }
        console.log('Đã gán tất cả quyền cho vai trò Admin.');

        // Gán quyền cơ bản cho vai trò Member (ví dụ: chỉ xem người dùng, truy cập ứng dụng bán hàng)
        const memberBasicPermissions = [
            createdPermissions['view users'],
            createdPermissions['access_app_sales'],
            createdPermissions['access_app_ql_khachhang'],
            createdPermissions['access_app_ql_donhang'],
            // Thêm các quyền khác mà member nên có
        ].filter(Boolean); // Lọc bỏ giá trị undefined nếu có quyền không tồn tại

        for (const permId of memberBasicPermissions) {
            await pool.execute(
                'INSERT IGNORE INTO role_has_permissions (role_id, permission_id) VALUES (?, ?)',
                [memberRoleId, permId]
            );
        }
        console.log('Đã gán quyền cơ bản cho vai trò Member.');

        // Tạo người dùng Admin đầu tiên và gán vai trò Admin cho họ
        const adminEmail = 'admin@example.com';
        const adminPassword = 'password123'; // Thay đổi mật khẩu mạnh hơn trong môi trường production!
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(adminPassword, salt);

        const [existingAdmin] = await pool.execute('SELECT id FROM users WHERE email = ?', [adminEmail]);
        let adminUserId;

        if (existingAdmin.length === 0) {
            const [result] = await pool.execute(
                'INSERT INTO users (name, email, password, active) VALUES (?, ?, ?, ?)',
                ['Admin User', adminEmail, hashedPassword, true]
            );
            adminUserId = result.insertId;
            console.log(`Đã tạo người dùng Admin: ${adminEmail}`);
        } else {
            adminUserId = existingAdmin[0].id;
            console.log(`Người dùng Admin ${adminEmail} đã tồn tại.`);
        }

        // Gán vai trò Admin cho người dùng Admin
        await pool.execute(
            'INSERT IGNORE INTO model_has_roles (role_id, model_type, model_id) VALUES (?, ?, ?)',
            [adminRoleId, 'App\\Models\\User', adminUserId] // model_type cần khớp với Laravel nếu bạn dùng chung DB
        );
        console.log(`Đã gán vai trò Admin cho người dùng ${adminEmail}.`);

        console.log('--- Quá trình seeding hoàn tất ---');

    } catch (error) {
        console.error('Lỗi trong quá trình seeding:', error);
    } finally {
        // Đóng pool kết nối sau khi seeding hoàn tất (hoặc không đóng nếu bạn muốn giữ kết nối cho ứng dụng)
        // pool.end(); // Chỉ gọi pool.end() nếu bạn muốn đóng tất cả kết nối ngay lập tức
    }
}

// Gọi hàm seeding khi script này được chạy
seedRolesAndPermissions();
