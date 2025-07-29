// duongbackend/controllers/roleController.js

const { pool } = require('../config/db');

// Hàm xử lý lấy tất cả vai trò
const index = async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT
                r.id, r.name, r.description, r.created_at, r.updated_at,
                COUNT(DISTINCT mhr.model_id) AS users_count,
                GROUP_CONCAT(DISTINCT p.name ORDER BY p.name ASC) AS permissions_name
            FROM roles r
            LEFT JOIN model_has_roles mhr ON r.id = mhr.role_id
            LEFT JOIN role_has_permissions rhp ON r.id = rhp.role_id
            LEFT JOIN permissions p ON rhp.permission_id = p.id
            GROUP BY r.id
            ORDER BY r.name ASC
        `);

        const formattedRoles = rows.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            users_count: row.users_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
            permissions: row.permissions_name ? row.permissions_name.split(',') : []
        }));

        res.json(formattedRoles);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách vai trò:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi lấy danh sách vai trò.' });
    }
};

// Hàm xử lý lấy một vai trò cụ thể và các quyền của nó
const show = async (req, res) => {
    const roleId = req.params.id;
    try {
        const [roles] = await pool.execute(`
            SELECT
                r.id, r.name, r.description,
                GROUP_CONCAT(DISTINCT p.id ORDER BY p.id ASC) AS permission_ids,
                GROUP_CONCAT(DISTINCT p.name ORDER BY p.name ASC) AS permission_names
            FROM roles r
            LEFT JOIN role_has_permissions rhp ON r.id = rhp.role_id
            LEFT JOIN permissions p ON rhp.permission_id = p.id
            WHERE r.id = ?
            GROUP BY r.id
        `, [roleId]);

        const role = roles[0];

        if (!role) {
            return res.status(404).json({ message: 'Không tìm thấy vai trò.' });
        }

        res.json({
            id: role.id,
            name: role.name,
            description: role.description,
            permissions: role.permission_ids && role.permission_names ?
                         role.permission_ids.split(',').map((id, index) => ({ id: parseInt(id), name: role.permission_names.split(',')[index] })) :
                         []
        });

    } catch (error) {
        console.error('Lỗi khi lấy thông tin vai trò:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi lấy thông tin vai trò.' });
    }
};

// Hàm xử lý tạo vai trò mới
const store = async (req, res) => {
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ message: 'Tên vai trò là bắt buộc.' });
    }
    try {
        const [existingRole] = await pool.execute('SELECT id FROM roles WHERE name = ?', [name]);
        if (existingRole.length > 0) {
            return res.status(400).json({ message: 'Tên vai trò đã tồn tại.' });
        }
        const [result] = await pool.execute('INSERT INTO roles (name, description) VALUES (?, ?)', [name, description]);
        res.status(201).json({ message: 'Vai trò đã được tạo thành công!', role_id: result.insertId });
    } catch (error) {
        console.error('Lỗi khi tạo vai trò:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi tạo vai trò.' });
    }
};

// Hàm xử lý cập nhật vai trò
const update = async (req, res) => {
    const roleId = req.params.id;
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ message: 'Tên vai trò là bắt buộc.' });
    }
    try {
        const [existingRole] = await pool.execute('SELECT id FROM roles WHERE name = ? AND id != ?', [name, roleId]);
        if (existingRole.length > 0) {
            return res.status(400).json({ message: 'Tên vai trò đã tồn tại.' });
        }
        const [result] = await pool.execute('UPDATE roles SET name = ?, description = ? WHERE id = ?', [name, description, roleId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy vai trò để cập nhật.' });
        }
        res.json({ message: 'Vai trò đã được cập nhật thành công!' });
    } catch (error) {
        console.error('Lỗi khi cập nhật vai trò:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi cập nhật vai trò.' });
    }
};

// Hàm xử lý xóa vai trò
const destroy = async (req, res) => {
    const roleId = req.params.id;
    try {
        // Xóa các liên kết trong bảng trung gian trước
        await pool.execute('DELETE FROM model_has_roles WHERE role_id = ?', [roleId]);
        await pool.execute('DELETE FROM role_has_permissions WHERE role_id = ?', [roleId]);

        const [result] = await pool.execute('DELETE FROM roles WHERE id = ?', [roleId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy vai trò để xóa.' });
        }
        res.json({ message: 'Vai trò đã được xóa thành công!' });
    } catch (error) {
        console.error('Lỗi khi xóa vai trò:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi xóa vai trò.' });
    }
};

// Hàm xử lý đồng bộ quyền hạn cho một vai trò
const syncPermissions = async (req, res) => {
    const roleId = req.params.id;
    const { permissions } = req.body; // 'permissions' là một mảng các tên quyền (string)

    if (!Array.isArray(permissions)) {
        return res.status(400).json({ message: 'Dữ liệu quyền không hợp lệ.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Xóa tất cả các quyền hiện có của vai trò này
        await connection.execute('DELETE FROM role_has_permissions WHERE role_id = ?', [roleId]);

        // Thêm các quyền mới
        if (permissions.length > 0) {
            // Lấy IDs của các quyền từ tên quyền
            const [permissionRows] = await connection.execute(
                `SELECT id FROM permissions WHERE name IN (${permissions.map(() => '?').join(',')})`,
                permissions
            );
            const permissionIds = permissionRows.map(row => row.id);

            if (permissionIds.length !== permissions.length) {
                await connection.rollback();
                return res.status(400).json({ message: 'Một hoặc nhiều quyền không tồn tại.' });
            }

            const inserts = permissionIds.map(permId => [roleId, permId]);
            await connection.query('INSERT INTO role_has_permissions (role_id, permission_id) VALUES ?', [inserts]);
        }

        await connection.commit();
        res.json({ message: 'Quyền hạn của vai trò đã được cập nhật thành công!' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Lỗi khi đồng bộ quyền hạn cho vai trò:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi cập nhật quyền hạn.' });
    } finally {
        if (connection) connection.release();
    }
};

// Hàm xử lý lấy tất cả quyền hạn (cho dropdown/checkboxes)
const allPermissions = async (req, res) => {
    try {
        const [permissions] = await pool.execute('SELECT id, name, description FROM permissions ORDER BY name ASC');
        res.json(permissions);
    } catch (error) {
        console.error('Lỗi khi lấy tất cả quyền hạn:', error);
        res.status(500).json({ message: 'Đã xảy ra lỗi server khi lấy quyền hạn.' });
    }
};

// Xuất tất cả các hàm xử lý
module.exports = {
    index,
    show,
    store,
    update,
    destroy,
    syncPermissions,
    allPermissions,
};
