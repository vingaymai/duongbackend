// duongbackend/controllers/userController.js

const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');

// KHÔNG CẦN IMPORT checkPermission NỮA, VÌ CHÚNG TA DÙNG authorize LÀM MIDDLEWARE
// const { checkPermission } = require('../middleware/authorizeMiddleware');

// Hàm xử lý lấy danh sách người dùng
const index = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10; // Mặc định 10 người dùng mỗi trang
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    // 1. Truy vấn chính để lấy thông tin cơ bản của người dùng
    let userSql = `SELECT id, name, email, active, created_at, updated_at FROM users`;
    let countSql = `SELECT COUNT(id) AS total FROM users`;
    let userParams = []; // Tham số chỉ cho phần WHERE (nếu có search)
    let countParams = []; // Tham số chỉ cho phần WHERE (nếu có search)

    if (search) {
        userSql += ` WHERE name LIKE ? OR email LIKE ?`;
        countSql += ` WHERE name LIKE ? OR email LIKE ?`;
        userParams.push(`%${search}%`, `%${search}%`);
        countParams.push(`%${search}%`, `%${search}%`);
    }

    // Nhúng trực tiếp LIMIT và OFFSET vào chuỗi SQL để tránh lỗi "Incorrect arguments"
    userSql += ` ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;

    try {
        const [usersRaw] = await pool.execute(userSql, userParams);

        const [countResult] = await pool.execute(countSql, countParams);
        const totalUsers = countResult[0].total;
        const totalPages = Math.ceil(totalUsers / limit);

        // Nếu không có người dùng nào, trả về ngay
        if (usersRaw.length === 0) {
            return res.status(200).json({
                data: [],
                pagination: {
                    total: totalUsers,
                    per_page: limit,
                    current_page: page,
                    last_page: totalPages,
                    from: offset + 1,
                    to: offset,
                },
            });
        }

        // 2. Lấy IDs của các người dùng vừa được fetch
        const userIds = usersRaw.map(user => user.id);

        // 3. Fetch roles cho tất cả các người dùng đã được fetch
        const roleQueryPlaceholders = userIds.map(() => '?').join(',');
        const [rolesRaw] = await pool.execute(`
            SELECT mhr.model_id AS userId, r.id AS roleId, r.name AS roleName
            FROM model_has_roles mhr
            JOIN roles r ON mhr.role_id = r.id
            WHERE mhr.model_id IN (${roleQueryPlaceholders}) AND mhr.model_type = 'App\\\\\\\\Models\\\\\\\\User'
        `, userIds);


        // 4. Fetch branches cho tất cả các người dùng đã được fetch
        const branchQueryPlaceholders = userIds.map(() => '?').join(',');
        const [branchesRaw] = await pool.execute(`
            SELECT bu.user_id AS userId, b.id AS branchId, b.name AS branchName
            FROM branch_user bu
            JOIN branches b ON bu.branch_id = b.id
            WHERE bu.user_id IN (${branchQueryPlaceholders})
        `, userIds);


        // 5. Xử lý và gán vai trò, chi nhánh vào từng người dùng trong Node.js
        const users = usersRaw.map(user => {
            // Lọc và ánh xạ vai trò cho người dùng hiện tại
            const userRoles = rolesRaw
                .filter(role => role.userId === user.id)
                .map(role => ({ id: role.roleId, name: role.roleName }));
            
            // Lọc và ánh xạ chi nhánh cho người dùng hiện tại
            const userBranches = branchesRaw
                .filter(branch => branch.userId === user.id)
                .map(branch => ({ id: branch.branchId, name: branch.branchName }));

            return {
                ...user,
                roles: userRoles,
                branches: userBranches,
                // Để tương thích với frontend nếu nó cần role_ids/store_ids riêng
                role_ids: userRoles.map(r => r.id),
                store_ids: userBranches.map(b => b.id)
            };
        });


        res.status(200).json({
            data: users,
            pagination: {
                total: totalUsers,
                per_page: limit,
                current_page: page,
                last_page: totalPages,
                from: offset + 1,
                to: offset + users.length,
            },
        });
    } catch (error) {
        console.error('Lỗi khi lấy danh sách người dùng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi lấy danh sách người dùng.', error: error.message });
    }
};


// Hàm xử lý lấy thông tin một người dùng cụ thể (ví dụ để chỉnh sửa)
const show = async (req, res) => {
    const userId = req.params.id;
    try {
        // Lấy thông tin người dùng cơ bản
        const [users] = await pool.execute('SELECT id, name, email, active FROM users WHERE id = ?', [userId]);

        if (users.length === 0) {
            return res.status(404).json({ message: 'Người dùng không tìm thấy.' });
        }

        const user = users[0];

        // Lấy các vai trò của người dùng
        const rolesQuery = `SELECT r.id, r.name FROM roles r
             JOIN model_has_roles mhr ON r.id = mhr.role_id
             WHERE mhr.model_id = ? AND mhr.model_type = 'App\\\\\\\\Models\\\\\\\\User'`;
        const [userRolesRaw] = await pool.execute(rolesQuery, [userId]);

        user.roles = userRolesRaw; // Gán trực tiếp mảng đối tượng {id, name}
        user.role_ids = userRolesRaw.map(role => role.id); // Gán mảng ID


        // Lấy các chi nhánh của người dùng
        const branchesQuery = `SELECT b.id, b.name FROM branches b
             JOIN branch_user bu ON b.id = bu.branch_id
             WHERE bu.user_id = ?`;
        const [userBranchesRaw] = await pool.execute(branchesQuery, [userId]);

        user.branches = userBranchesRaw; // Gán trực tiếp mảng đối tượng {id, name}
        user.store_ids = userBranchesRaw.map(branch => branch.id); // Gán mảng ID

        res.json(user);
    } catch (error) {
        console.error('Lỗi khi lấy thông tin người dùng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server.' });
    }
};

// Hàm xử lý tạo người dùng mới
const store = async (req, res) => {
    const { name, email, password, password_confirmation, active, role_ids, store_ids } = req.body;

    // Xác thực cơ bản
    if (password !== password_confirmation) {
        return res.status(422).json({ errors: { password_confirmation: ['Mật khẩu xác nhận không khớp.'] } });
    }

    const connection = await pool.getConnection(); // Lấy kết nối từ pool
    try {
        await connection.beginTransaction(); // Bắt đầu giao dịch

        const hashedPassword = await bcrypt.hash(password, 10);

        // Chèn người dùng mới
        const [userResult] = await connection.execute(
            'INSERT INTO users (name, email, password, active) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, active]
        );
        const userId = userResult.insertId;

        // Đồng bộ vai trò (Sync roles)
        if (role_ids && role_ids.length > 0) {
            // Tạo một mảng các mảng con cho VALUES (?, ?, ?)
            const roleValues = role_ids.map(roleId => [userId, roleId, 'App\\\\Models\\\\User']); // Đảm bảo 4 dấu gạch chéo
            // Chuyển đổi mảng các mảng con thành chuỗi phẳng cho execute
            const flatRoleValues = roleValues.flat();
            // Tạo chuỗi placeholders cho SQL
            const rolePlaceholders = role_ids.map(() => '(?, ?, ?)').join(', ');

            await connection.execute(
                `INSERT INTO model_has_roles (model_id, role_id, model_type) VALUES ${rolePlaceholders}`,
                flatRoleValues
            );
        }

        // Đồng bộ chi nhánh (Sync branches)
        if (store_ids && store_ids.length > 0) {
            // Tạo một mảng các mảng con cho VALUES (?, ?)
            const branchValues = store_ids.map(branchId => [userId, branchId]);
            // Chuyển đổi mảng các mảng con thành chuỗi phẳng cho execute
            const flatBranchValues = branchValues.flat();
            // Tạo chuỗi placeholders cho SQL
            const branchPlaceholders = store_ids.map(() => '(?, ?)').join(', ');

            await connection.execute(
                `INSERT INTO branch_user (user_id, branch_id) VALUES ${branchPlaceholders}`,
                flatBranchValues
            );
        }

        await connection.commit(); // Hoàn thành giao dịch
        res.status(201).json({ message: 'Người dùng đã được tạo thành công!', user_id: userId });

    } catch (error) {
        await connection.rollback(); // Hoàn tác nếu có lỗi
        console.error('Lỗi khi tạo người dùng:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ errors: { email: ['Email này đã tồn tại.'] } });
        }
        if (error.code === 'ER_PARSE_ERROR') {
             console.error('Lỗi cú pháp SQL:', error.sqlMessage);
             return res.status(500).json({ message: 'Lỗi cú pháp SQL trong quá trình tạo người dùng. Vui lòng kiểm tra log backend.' });
        }
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi tạo người dùng.' });
    } finally {
        connection.release(); // Giải phóng kết nối
    }
};


// Hàm xử lý cập nhật người dùng
const update = async (req, res) => {
    const userId = req.params.id;
    const { name, email, password, password_confirmation, active, role_ids, store_ids } = req.body;

    console.log(`DEBUG (update): Bắt đầu cập nhật người dùng ${userId}.`);
    console.log(`DEBUG (update): Dữ liệu nhận được - role_ids:`, role_ids);
    console.log(`DEBUG (update): Dữ liệu nhận được - store_ids:`, store_ids);

    const connection = await pool.getConnection(); // Lấy kết nối từ pool
    try {
        await connection.beginTransaction(); // Bắt đầu giao dịch

        // 1. Cập nhật thông tin người dùng chính
        let userUpdateSql = 'UPDATE users SET name = ?, email = ?, active = ?';
        let userUpdateParams = [name, email, active];

        if (password) {
            if (password !== password_confirmation) {
                await connection.rollback();
                return res.status(422).json({ errors: { password_confirmation: ['Mật khẩu xác nhận không khớp.'] } });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            userUpdateSql += ', password = ?';
            userUpdateParams.push(hashedPassword);
        }
        userUpdateSql += ' WHERE id = ?';
        userUpdateParams.push(userId);

        console.log('DEBUG (update): SQL cập nhật người dùng:', userUpdateSql);
        console.log('DEBUG (update): Tham số cập nhật người dùng:', userUpdateParams);
        const [userUpdateResult] = await connection.execute(userUpdateSql, userUpdateParams);
        console.log(`DEBUG (update): Đã cập nhật ${userUpdateResult.affectedRows} hàng trong bảng users.`);


        // 2. Đồng bộ vai trò: Xóa cũ, thêm mới
        console.log(`DEBUG (update): Đang xóa vai trò cũ cho người dùng ${userId}...`);
        // Đảm bảo model_type khớp với cách MySQL lưu trữ (4 dấu gạch chéo)
        const [deleteRolesResult] = await connection.execute('DELETE FROM model_has_roles WHERE model_id = ? AND model_type = ?', [userId, 'App\\\\Models\\\\User']);
        console.log(`DEBUG (update): Đã xóa ${deleteRolesResult.affectedRows} bản ghi vai trò cũ.`);

        if (role_ids && role_ids.length > 0) {
            // SỬA LỖI Ở ĐÂY: Đảm bảo model_type nhất quán (4 dấu gạch chéo)
            const roleValues = role_ids.map(roleId => [userId, roleId, 'App\\\\Models\\\\User']); 
            const flatRoleValues = roleValues.flat();
            const rolePlaceholders = role_ids.map(() => '(?, ?, ?)').join(', ');

            console.log('DEBUG (update): SQL chèn vai trò mới:', `INSERT INTO model_has_roles (model_id, role_id, model_type) VALUES ${rolePlaceholders}`);
            console.log('DEBUG (update): Tham số chèn vai trò mới:', flatRoleValues);
            const [insertRolesResult] = await connection.execute(
                `INSERT INTO model_has_roles (model_id, role_id, model_type) VALUES ${rolePlaceholders}`,
                flatRoleValues
            );
            console.log(`DEBUG (update): Đã chèn ${insertRolesResult.affectedRows} bản ghi vai trò mới.`);
        } else {
            console.log('DEBUG (update): Không có role_ids được cung cấp hoặc mảng rỗng. Không chèn vai trò mới.');
        }

        // 3. Đồng bộ chi nhánh: Xóa cũ, thêm mới
        console.log(`DEBUG (update): Đang xóa chi nhánh cũ cho người dùng ${userId}...`);
        const [deleteBranchesResult] = await connection.execute('DELETE FROM branch_user WHERE user_id = ?', [userId]);
        console.log(`DEBUG (update): Đã xóa ${deleteBranchesResult.affectedRows} bản ghi chi nhánh cũ.`);

        if (store_ids && store_ids.length > 0) {
            const branchValues = store_ids.map(branchId => [userId, branchId]);
            const flatBranchValues = branchValues.flat();
            const branchPlaceholders = store_ids.map(() => '(?, ?)').join(', ');

            console.log('DEBUG (update): SQL chèn chi nhánh mới:', `INSERT INTO branch_user (user_id, branch_id) VALUES ${branchPlaceholders}`);
            console.log('DEBUG (update): Tham số chèn chi nhánh mới:', flatBranchValues);
            const [insertBranchesResult] = await connection.execute(
                `INSERT INTO branch_user (user_id, branch_id) VALUES ${branchPlaceholders}`,
                flatBranchValues
            );
            console.log(`DEBUG (update): Đã chèn ${insertBranchesResult.affectedRows} bản ghi chi nhánh mới.`);
        } else {
            console.log('DEBUG (update): Không có store_ids được cung cấp hoặc mảng rỗng. Không chèn chi nhánh mới.');
        }

        await connection.commit(); // Hoàn thành giao dịch
        console.log(`DEBUG (update): Giao dịch cho người dùng ${userId} đã được commit thành công.`);
        res.json({ message: 'Người dùng đã được cập nhật thành công!' });

    } catch (error) {
        await connection.rollback(); // Hoàn tác nếu có lỗi
        console.error(`DEBUG (update): Giao dịch cho người dùng ${userId} đã bị rollback do lỗi:`, error);
        console.error('Lỗi khi cập nhật người dùng:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ errors: { email: ['Email này đã tồn tại.'] } });
        }
        if (error.code === 'ER_PARSE_ERROR') {
             console.error('Lỗi cú pháp SQL:', error.sqlMessage);
             return res.status(500).json({ message: 'Lỗi cú pháp SQL trong quá trình cập nhật người dùng. Vui lòng kiểm tra log backend.' });
        }
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi cập nhật người dùng.' });
    } finally {
        connection.release(); // Giải phóng kết nối
        console.log(`DEBUG (update): Kết nối cơ sở dữ liệu đã được giải phóng cho người dùng ${userId}.`);
    }
};

// Hàm xử lý xóa người dùng
const destroy = async (req, res) => {
    const userId = req.params.id;
    const connection = await pool.getConnection(); // Lấy kết nối từ pool
    try {
        await connection.beginTransaction(); // Bắt đầu giao dịch

        // Xóa các liên kết trong bảng trung gian trước (nếu không dùng CASCADE on DELETE)
        await connection.execute('DELETE FROM model_has_roles WHERE model_id = ? AND model_type = ?', [userId, MODEL_TYPE_USER]);
        await connection.execute('DELETE FROM branch_user WHERE user_id = ?', [userId]);

        const [result] = await connection.execute('DELETE FROM users WHERE id = ?', [userId]);

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Không tìm thấy người dùng để xóa.' });
        }

        await connection.commit(); // Hoàn thành giao dịch
        res.json({ message: 'Người dùng đã được xóa thành công!' });
    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi xóa người dùng:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi xóa người dùng.' });
    } finally {
        connection.release();
    }
};

module.exports = {
    index,
    show,
    store,
    update,
    destroy
};
