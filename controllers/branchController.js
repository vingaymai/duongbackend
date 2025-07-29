// duongbackend/controllers/branchController.js

const { pool } = require('../config/db');

// Lấy tất cả chi nhánh
const index = async (req, res) => {
    try {
        const { search } = req.query; // Lấy tham số tìm kiếm từ query string
        let query = `
            SELECT 
                id, name, address, phone, manager_name, active, 
                created_at, updated_at
            FROM branches
        `;
        const queryParams = [];

        if (search) {
            query += ` WHERE name LIKE ? OR address LIKE ? OR phone LIKE ? OR manager_name LIKE ?`;
            const searchTerm = `%${search}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        query += ` ORDER BY name ASC`; // Sắp xếp theo tên chi nhánh

        const [rows] = await pool.execute(query, queryParams);

        // Chuyển đổi giá trị active sang boolean
        const branches = rows.map(row => ({
            ...row,
            active: !!row.active // Chuyển đổi 0/1 sang false/true
        }));

        res.status(200).json(branches);
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).json({ message: 'Lỗi khi tải danh sách chi nhánh', error: error.message });
    }
};
// GET /my-branches
const indexUserBranches = async (req, res) => {
    const userBranchIds = req.user.branch_ids || [];
  
    if (userBranchIds.length === 0) {
      return res.status(200).json([]);
    }
  
    try {
      const placeholders = userBranchIds.map(() => '?').join(',');
      const [rows] = await pool.execute(`
        SELECT id, name, address, phone, manager_name, active, created_at, updated_at
        FROM branches
        WHERE id IN (${placeholders})
        ORDER BY name ASC
      `, userBranchIds);
  
      const branches = rows.map(row => ({
        ...row,
        active: !!row.active
      }));
  
      res.status(200).json(branches);
    } catch (error) {
      console.error('Error fetching user branches:', error);
      res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
  };
  
// Lấy một chi nhánh theo ID
const show = async (req, res) => {
    const branchId = req.params.id;
    try {
        const [rows] = await pool.execute(`
            SELECT 
                id, name, address, phone, manager_name, active, 
                created_at, updated_at
            FROM branches
            WHERE id = ?
        `, [branchId]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Chi nhánh không tìm thấy.' });
        }

        const branch = {
            ...rows[0],
            active: !!rows[0].active // Chuyển đổi 0/1 sang false/true
        };

        res.status(200).json(branch);
    } catch (error) {
        console.error('Error fetching branch:', error);
        res.status(500).json({ message: 'Lỗi khi tải thông tin chi nhánh', error: error.message });
    }
};

// Tạo chi nhánh mới
const store = async (req, res) => {
    const { name, address, phone, manager_name, active } = req.body;
    try {
        // Kiểm tra dữ liệu đầu vào
        if (!name || !address) {
            return res.status(400).json({ message: 'Tên và địa chỉ chi nhánh là bắt buộc.' });
        }

        // Kiểm tra trùng lặp tên chi nhánh (tùy chọn, nhưng nên có)
        const [existingBranch] = await pool.execute('SELECT id FROM branches WHERE name = ?', [name]);
        if (existingBranch.length > 0) {
            return res.status(422).json({ message: 'Tên chi nhánh đã tồn tại.', errors: { name: ['Tên chi nhánh đã tồn tại.'] } });
        }

        const [result] = await pool.execute(
            `INSERT INTO branches (name, address, phone, manager_name, active) VALUES (?, ?, ?, ?, ?)`,
            [name, address, phone || null, manager_name || null, !!active]
        );

        res.status(201).json({ message: 'Chi nhánh đã được thêm mới thành công', branchId: result.insertId });
    } catch (error) {
        console.error('Error creating branch:', error);
        res.status(500).json({ message: 'Lỗi khi thêm chi nhánh mới', error: error.message });
    }
};

// Cập nhật chi nhánh
const update = async (req, res) => {
    const branchId = req.params.id;
    const { name, address, phone, manager_name, active } = req.body;
    try {
        // Kiểm tra dữ liệu đầu vào
        if (!name || !address) {
            return res.status(400).json({ message: 'Tên và địa chỉ chi nhánh là bắt buộc.' });
        }

        // Kiểm tra trùng lặp tên chi nhánh (trừ chi nhánh hiện tại)
        const [existingBranch] = await pool.execute('SELECT id FROM branches WHERE name = ? AND id != ?', [name, branchId]);
        if (existingBranch.length > 0) {
            return res.status(422).json({ message: 'Tên chi nhánh đã tồn tại.', errors: { name: ['Tên chi nhánh đã tồn tại.'] } });
        }

        const [result] = await pool.execute(
            `UPDATE branches SET name = ?, address = ?, phone = ?, manager_name = ?, active = ? WHERE id = ?`,
            [name, address, phone || null, manager_name || null, !!active, branchId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Chi nhánh không tìm thấy hoặc không có thay đổi nào được thực hiện.' });
        }

        res.status(200).json({ message: 'Chi nhánh đã được cập nhật thành công.' });
    } catch (error) {
        console.error('Error updating branch:', error);
        res.status(500).json({ message: 'Lỗi khi cập nhật chi nhánh', error: error.message });
    }
};

// Xóa chi nhánh
const destroy = async (req, res) => {
    const branchId = req.params.id;
    try {
        // Kiểm tra xem chi nhánh có tồn tại không
        const [existingBranch] = await pool.execute('SELECT id FROM branches WHERE id = ?', [branchId]);
        if (existingBranch.length === 0) {
            return res.status(404).json({ message: 'Chi nhánh không tìm thấy.' });
        }

        // TODO: Thêm logic kiểm tra ràng buộc khóa ngoại nếu cần (ví dụ: không cho xóa nếu có sản phẩm tồn kho tại chi nhánh này)
        // Ví dụ:
        // const [productsInBranch] = await pool.execute('SELECT COUNT(*) AS count FROM products WHERE branch_id = ?', [branchId]);
        // if (productsInBranch[0].count > 0) {
        //     return res.status(400).json({ message: 'Không thể xóa chi nhánh vì còn sản phẩm tồn kho tại đây.' });
        // }

        const [result] = await pool.execute(`DELETE FROM branches WHERE id = ?`, [branchId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Chi nhánh không tìm thấy để xóa.' });
        }

        res.status(200).json({ message: 'Chi nhánh đã được xóa thành công.' });
    } catch (error) {
        console.error('Error deleting branch:', error);
        res.status(500).json({ message: 'Lỗi khi xóa chi nhánh', error: error.message });
    }
};

module.exports = {
    index,
    indexUserBranches, // ✅ Thêm dòng này
    show,
    store,
    update,
    destroy,
};
