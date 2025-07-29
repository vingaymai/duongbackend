// duongbackend/controllers/customerController.js

const { pool } = require('../config/db');
const xlsx = require('xlsx'); // Cần cài đặt: npm install xlsx
const moment = require('moment'); // Cần cài đặt: npm install moment


const getBranchesList = async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const [branches] = await connection.query(
        `SELECT id, name FROM branches WHERE active = 1 ORDER BY name`
      );
      res.json(branches);
    } catch (error) {
      console.error('Lỗi khi lấy danh sách chi nhánh:', error);
      res.status(500).json({ message: 'Lỗi khi tải danh sách chi nhánh.' });
    } finally {
      connection.release();
    }
  };

// Lấy tất cả khách hàng
const index = async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const { search, branch_id: requestedBranchId, page = 1, per_page = 10 } = req.query;
      const userBranchIds = req.user.branch_ids || [];
      const isAdmin = req.user.roles && req.user.roles.some(role => role.name === 'admin');
  
      if (!userBranchIds.length && !isAdmin) {
        return res.status(403).json({ message: 'Người dùng không có chi nhánh nào được phân quyền hoặc không có quyền truy cập.' });
      }
  
      let query = `
        SELECT
          c.id,
          c.name,
          c.email,
          c.phone,
          c.address,
          c.city,
          c.country,
          c.date_of_birth,
          c.gender,
          c.total_spent,
          c.total_visits,
          c.active,
          c.created_at,
          c.updated_at,
          c.created_branch_id,
          b.name AS created_branch_name
        FROM customers c
        LEFT JOIN branches b ON c.created_branch_id = b.id
      `;
  
      let countQuery = `
        SELECT COUNT(*) AS total
        FROM customers c
        LEFT JOIN branches b ON c.created_branch_id = b.id
      `;
  
      const conditions = [];
      const params = [];
      const countParams = [];
  
      if (requestedBranchId && requestedBranchId !== 'all') {
        const branchId = parseInt(requestedBranchId, 10);
        if (!isAdmin && !userBranchIds.includes(branchId)) {
          return res.status(403).json({ message: 'Bạn không có quyền truy cập chi nhánh này.' });
        }
        conditions.push(`c.created_branch_id = ?`);
        params.push(branchId);
        countParams.push(branchId);
      } else if (!isAdmin && userBranchIds.length > 0) {
        conditions.push(`c.created_branch_id IN (${userBranchIds.map(() => '?').join(',')})`);
        params.push(...userBranchIds);
        countParams.push(...userBranchIds);
      }
  
      if (search) {
        const searchTerm = `%${search}%`;
        conditions.push(`(c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.address LIKE ?)`);
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }
  
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
        countQuery += ` WHERE ${conditions.join(' AND ')}`;
      }
  
      query += ` ORDER BY c.created_at DESC`;
  
      const limit = parseInt(per_page, 10) || 10;
      const currentPage = parseInt(page, 10) || 1;
      const offset = (currentPage - 1) * limit;
  
      // Chèn limit và offset trực tiếp, KHÔNG dùng tham số cho LIMIT và OFFSET
      query += ` LIMIT ${limit} OFFSET ${offset}`;
  
      // Log để debug
      console.log('Query:', query);
      console.log('Params:', params);
  
      const [rows] = await connection.execute(query, params);
      const [totalRows] = await connection.execute(countQuery, countParams);
      const total = totalRows[0].total;
  
      res.json({
        data: rows,
        total,
        current_page: currentPage,
        per_page: limit,
        last_page: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error('Lỗi khi lấy danh sách khách hàng:', error);
      res.status(500).json({ message: 'Lỗi server khi lấy danh sách khách hàng.' });
    } finally {
      connection.release();
    }
  };
      

// Lấy chi tiết một khách hàng
const show = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.roles && req.user.roles.some(role => role.name === 'admin');

        // Query lấy khách hàng cùng tên chi nhánh tạo dựa vào created_branch_id
        const query = `
            SELECT
                c.id,
                c.name,
                c.email,
                c.phone,
                c.address,
                c.city,
                c.country,
                c.date_of_birth,
                c.gender,
                c.total_spent,
                c.total_visits,
                c.active,
                c.created_at,
                c.updated_at,
                c.created_branch_id,
                b.name AS created_branch_name
            FROM customers c
            LEFT JOIN branches b ON c.created_branch_id = b.id
            WHERE c.id = ?
        `;
        const [rows] = await connection.execute(query, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
        }

        const customer = rows[0];

        // Kiểm tra quyền truy cập chi nhánh của khách hàng
        if (!isAdmin && customer.created_branch_id && !userBranchIds.includes(customer.created_branch_id)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem chi tiết khách hàng này.' });
        }

        res.json(customer);

    } catch (error) {
        console.error('Lỗi khi lấy chi tiết khách hàng:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy chi tiết khách hàng.' });
    } finally {
        connection.release();
    }
};

// Tạo mới khách hàng
const store = async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
      const {
        name, email, phone, address, city, country,
        date_of_birth, gender, total_spent, total_visits, active, created_branch_id // <-- Đảm bảo nhận created_branch_id
      } = req.body;

      const userBranchIds = req.user.branch_ids || [];
      const isAdmin = req.user.roles?.some(role => role.name === 'admin');

      // Kiểm tra quyền gán chi nhánh
      // Nếu không phải admin VÀ chi nhánh được chọn không nằm trong danh sách chi nhánh của người dùng
      if (!isAdmin && (!created_branch_id || !userBranchIds.includes(created_branch_id))) {
        await connection.rollback();
        return res.status(403).json({ message: 'Bạn không có quyền tạo khách hàng ở chi nhánh này.' });
      }

      // Kiểm tra trùng lặp Email/Phone trước khi INSERT (MySQL sẽ tự bắt, nhưng kiểm tra trước giúp trả lỗi rõ ràng hơn)
      if (email) {
          const [existingEmail] = await connection.execute(`SELECT id FROM customers WHERE email = ?`, [email]);
          if (existingEmail.length > 0) {
              await connection.rollback();
              return res.status(409).json({ message: 'Email này đã tồn tại.' });
          }
      }
      if (phone) {
          const [existingPhone] = await connection.execute(`SELECT id FROM customers WHERE phone = ?`, [phone]);
          if (existingPhone.length > 0) {
              await connection.rollback();
              return res.status(409).json({ message: 'Số điện thoại này đã tồn tại.' });
          }
      }


      const [result] = await connection.execute(
        `INSERT INTO customers (
            name, email, phone, address, city, country,
            date_of_birth, gender, total_spent, total_visits, active, created_branch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name, email, phone, address, city, country,
          date_of_birth, gender, total_spent, total_visits, active,
          created_branch_id // <-- Sử dụng created_branch_id nhận được từ frontend
        ]
      );

      await connection.commit();
      res.status(201).json({ message: 'Khách hàng đã được tạo thành công.', customerId: result.insertId });

    } catch (error) {
      await connection.rollback();
      console.error('Lỗi khi tạo khách hàng:', error);
      // MySQL Duplicate entry error code is usually 1062
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: 'Email hoặc số điện thoại đã tồn tại.' });
      }
      res.status(500).json({ message: 'Lỗi server khi tạo khách hàng.' });
    } finally {
      connection.release();
    }
};

// Cập nhật khách hàng
const update = async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
      const { id } = req.params;
      const {
        name, email, phone, address, city, country,
        date_of_birth, gender, total_spent, total_visits, active,
        // created_branch_id // <-- Không nhận created_branch_id ở đây nếu không cho phép sửa
      } = req.body;

      const userBranchIds = req.user.branch_ids || [];
      const isAdmin = req.user.roles?.some(role => role.name === 'admin');

      const [customerRows] = await connection.execute(
        `SELECT created_branch_id FROM customers WHERE id = ?`, [id]
      );

      if (customerRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
      }

      const customer = customerRows[0];

      // Kiểm tra quyền sửa
      if (!isAdmin && !userBranchIds.includes(customer.created_branch_id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'Bạn không có quyền chỉnh sửa khách hàng này.' });
      }

      // Kiểm tra trùng lặp Email/Phone (trừ chính khách hàng đang sửa)
      if (email) {
          const [existingEmail] = await connection.execute(`SELECT id FROM customers WHERE email = ? AND id != ?`, [email, id]);
          if (existingEmail.length > 0) {
              await connection.rollback();
              return res.status(409).json({ message: 'Email này đã tồn tại.' });
          }
      }
      if (phone) {
          const [existingPhone] = await connection.execute(`SELECT id FROM customers WHERE phone = ? AND id != ?`, [phone, id]);
          if (existingPhone.length > 0) {
              await connection.rollback();
              return res.status(409).json({ message: 'Số điện thoại này đã tồn tại.' });
          }
      }

      await connection.execute(
        `UPDATE customers SET
            name = ?, email = ?, phone = ?, address = ?, city = ?, country = ?,
            date_of_birth = ?, gender = ?, total_spent = ?, total_visits = ?, active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          name, email, phone, address, city, country,
          date_of_birth, gender, total_spent, total_visits, active, id
        ]
      );

      await connection.commit();
      res.json({ message: 'Khách hàng đã được cập nhật thành công.' });

    } catch (error) {
      await connection.rollback();
      console.error('Lỗi khi cập nhật khách hàng:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: 'Email hoặc số điện thoại đã tồn tại.' });
      }
      res.status(500).json({ message: 'Lỗi server khi cập nhật khách hàng.' });
    } finally {
      connection.release();
    }
};
  
// Xóa khách hàng
const destroy = async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
      const { id } = req.params;
      const userBranchIds = req.user.branch_ids || [];
      const isAdmin = req.user.roles?.some(role => role.name === 'admin');
  
      const [customerRows] = await connection.execute(
        `SELECT created_branch_id FROM customers WHERE id = ?`, [id]
      );
  
      if (customerRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
      }
  
      const customer = customerRows[0];
  
      // Kiểm tra quyền xóa
      if (!isAdmin && !userBranchIds.includes(customer.created_branch_id)) {
        await connection.rollback();
        return res.status(403).json({ message: 'Bạn không có quyền xóa khách hàng này.' });
      }
  
      const [result] = await connection.execute(`DELETE FROM customers WHERE id = ?`, [id]);
  
      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({ message: 'Không tìm thấy khách hàng để xóa.' });
      }
  
      await connection.commit();
      res.json({ message: 'Khách hàng đã được xóa thành công.' });
  
    } catch (error) {
      await connection.rollback();
      console.error('Lỗi khi xóa khách hàng:', error);
      res.status(500).json({ message: 'Lỗi server khi xóa khách hàng.' });
    } finally {
      connection.release();
    }
  };
  

// Export khách hàng ra Excel
const exportCustomers = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.roles?.some(role => role.name === 'admin');

        let query = `
            SELECT
                c.id AS 'ID',
                c.name AS 'Tên khách hàng',
                c.email AS 'Email',
                c.phone AS 'Điện thoại',
                c.address AS 'Địa chỉ',
                c.city AS 'Thành phố',
                c.country AS 'Quốc gia',
                DATE_FORMAT(c.date_of_birth, '%Y-%m-%d') AS 'Ngày sinh',
                CASE
                    WHEN c.gender = 'male' THEN 'Nam'
                    WHEN c.gender = 'female' THEN 'Nữ'
                    WHEN c.gender = 'other' THEN 'Khác'
                    ELSE ''
                END AS 'Giới tính',
                c.total_spent AS 'Tổng chi tiêu',
                c.total_visits AS 'Tổng lượt ghé thăm',
                CASE WHEN c.active THEN 'Có' ELSE 'Không' END AS 'Trạng thái',
                b.name AS 'Chi nhánh tạo',
                c.created_at AS 'Ngày tạo',
                c.updated_at AS 'Ngày cập nhật'
            FROM
                customers c
            LEFT JOIN
                branches b ON c.created_branch_id = b.id
        `;

        const conditions = [];
        const params = [];

        // Lọc theo chi nhánh được quyền truy cập
        if (!isAdmin && userBranchIds.length > 0) {
            conditions.push(`c.created_branch_id IN (${userBranchIds.map(() => '?').join(',')})`);
            params.push(...userBranchIds);
        } else if (!isAdmin) {
            return res.status(403).json({ message: 'Bạn không có quyền xuất khách hàng.' });
        }

        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }

        query += ` ORDER BY c.name ASC`;

        const [rows] = await connection.execute(query, params);

        const worksheet = xlsx.utils.json_to_sheet(rows);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Khách hàng');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename=khach_hang.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        console.error('Lỗi khi xuất khách hàng:', error);
        res.status(500).json({ message: 'Lỗi server khi xuất khách hàng.' });
    } finally {
        connection.release();
    }
};

// Import khách hàng từ Excel
const importCustomers = async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Vui lòng tải lên một file Excel.' });
        }

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = xlsx.utils.sheet_to_json(worksheet);

        const overwriteExisting = req.body.overwrite_existing === '1';
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.roles?.some(role => role.name === 'admin');

        // Xác định created_branch_id cho khách hàng import
        // Nếu admin, có thể gán cho một chi nhánh mặc định (ví dụ: ID 1), hoặc yêu cầu chọn từ frontend
        // Nếu không phải admin, phải là một trong các chi nhánh mà người dùng có quyền
        let defaultCreatedBranchIdForImport = null;
        if (isAdmin) {
            // Admin có thể import cho bất kỳ chi nhánh nào, hoặc một chi nhánh mặc định
            // Ví dụ: Lấy ID chi nhánh đầu tiên nếu có, hoặc ID mặc định
            const [branches] = await connection.query(`SELECT id FROM branches LIMIT 1`);
            defaultCreatedBranchIdForImport = branches.length > 0 ? branches[0].id : null;
            if (!defaultCreatedBranchIdForImport) {
                 await connection.rollback();
                 return res.status(400).json({ message: 'Không tìm thấy chi nhánh mặc định cho Admin để import.' });
            }
        } else if (userBranchIds.length > 0) {
            // Nếu không phải admin, chỉ có thể import vào chi nhánh mà họ được phân quyền
            // Nếu có nhiều chi nhánh, có thể cần người dùng chọn chi nhánh cụ thể trong UI import
            // Hiện tại, tạm lấy chi nhánh đầu tiên của user nếu có
            defaultCreatedBranchIdForImport = userBranchIds[0];
        } else {
            await connection.rollback();
            return res.status(400).json({ message: 'Không thể xác định chi nhánh tạo khách hàng cho việc import. Vui lòng liên hệ quản trị viên.' });
        }


        let importedCount = 0;
        let updatedCount = 0;
        const validationErrors = [];
        const conflicts = [];

        // Lấy danh sách chi nhánh để map tên chi nhánh sang ID
        const [allBranches] = await connection.execute(`SELECT id, name FROM branches`);
        const branchNameToIdMap = new Map(allBranches.map(b => [b.name.toLowerCase(), b.id]));

        for (let i = 0; i < jsonData.length; i++) {
            const row = jsonData[i];
            const rowNumber = i + 2; // Dòng trong Excel bắt đầu từ 1, header là 1, data từ 2

            const name = row['Tên khách hàng'];
            const email = row['Email'] || null;
            const phone = row['Điện thoại'] || null;
            const address = row['Địa chỉ'] || null;
            const city = row['Thành phố'] || null;
            const country = row['Quốc gia'] || null;
            const date_of_birth = row['Ngày sinh'] ? moment(row['Ngày sinh']).format('YYYY-MM-DD') : null;
            const genderRaw = row['Giới tính']?.toLowerCase() || null;
            const gender = ['nam', 'nữ', 'khác'].includes(genderRaw)
                ? (genderRaw === 'nam' ? 'male' : genderRaw === 'nữ' ? 'female' : 'other')
                : null;
            const total_spent = parseFloat(row['Tổng chi tiêu']) || 0;
            const total_visits = parseInt(row['Tổng lượt ghé thăm']) || 0;
            const active = row['Trạng thái']?.toLowerCase() === 'có' ? 1 : 0;
            const importCreatedBranchName = row['Chi nhánh tạo']?.toLowerCase() || null; // Tên chi nhánh tạo từ Excel

            const rowErrors = [];

            if (!name) rowErrors.push('Tên khách hàng không được để trống.');
            if (row['Giới tính'] && !gender) rowErrors.push('Giới tính không hợp lệ. Chỉ chấp nhận "Nam", "Nữ", "Khác".');
            if (!phone && !email) rowErrors.push('Phải có ít nhất Email hoặc Điện thoại.');

            if (rowErrors.length > 0) {
                validationErrors.push({ row: rowNumber, errors: rowErrors });
                continue;
            }

            // Xác định created_branch_id cho dòng hiện tại
            let currentCreatedBranchId = defaultCreatedBranchIdForImport;
            if (importCreatedBranchName) {
                const mappedBranchId = branchNameToIdMap.get(importCreatedBranchName);
                if (mappedBranchId) {
                    // Nếu admin, có thể gán theo tên chi nhánh trong Excel
                    // Nếu không admin, chỉ gán nếu chi nhánh đó nằm trong quyền của user
                    if (isAdmin || userBranchIds.includes(mappedBranchId)) {
                        currentCreatedBranchId = mappedBranchId;
                    } else {
                        rowErrors.push(`Bạn không có quyền gán khách hàng cho chi nhánh "${row['Chi nhánh tạo']}".`);
                    }
                } else {
                    rowErrors.push(`Chi nhánh tạo "${row['Chi nhánh tạo']}" không tồn tại.`);
                }
            }

            if (!currentCreatedBranchId) {
                 rowErrors.push('Không thể xác định chi nhánh tạo cho khách hàng này.');
            }

            if (rowErrors.length > 0) {
                validationErrors.push({ row: rowNumber, errors: rowErrors });
                continue;
            }


            let existingCustomer = null;
            if (email) {
                const [exist] = await connection.execute(`SELECT id, created_branch_id FROM customers WHERE email = ?`, [email]);
                if (exist.length > 0) existingCustomer = exist[0];
            }
            if (!existingCustomer && phone) {
                const [exist] = await connection.execute(`SELECT id, created_branch_id FROM customers WHERE phone = ?`, [phone]);
                if (exist.length > 0) existingCustomer = exist[0];
            }

            if (existingCustomer) {
                const canEdit = isAdmin || userBranchIds.includes(existingCustomer.created_branch_id);
                if (!canEdit) {
                    conflicts.push({
                        row: rowNumber,
                        proposed: { name, email, phone },
                        reason: 'Bạn không có quyền chỉnh sửa khách hàng hiện có.'
                    });
                    continue;
                }

                if (overwriteExisting) {
                    await connection.execute(
                        `UPDATE customers SET
                            name = ?, email = ?, phone = ?, address = ?, city = ?, country = ?,
                            date_of_birth = ?, gender = ?, total_spent = ?, total_visits = ?, active = ?, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        [
                            name, email, phone, address, city, country,
                            date_of_birth, gender, total_spent, total_visits, active, existingCustomer.id
                        ]
                    );
                    updatedCount++;
                } else {
                    conflicts.push({
                        row: rowNumber,
                        proposed: { name, email, phone },
                        reason: 'Khách hàng đã tồn tại và không được ghi đè.'
                    });
                    continue;
                }
            } else {
                await connection.execute(
                    `INSERT INTO customers (
                        name, email, phone, address, city, country,
                        date_of_birth, gender, total_spent, total_visits, active, created_branch_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        name, email, phone, address, city, country,
                        date_of_birth, gender, total_spent, total_visits, active,
                        currentCreatedBranchId // <-- Sử dụng created_branch_id đã xác định cho dòng này
                    ]
                );
                importedCount++;
            }
        }

        if (validationErrors.length > 0 || conflicts.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                message: 'Có lỗi hoặc xung đột trong quá trình import.',
                validationErrors,
                conflicts
            });
        }

        await connection.commit();
        res.json({
            message: 'Import khách hàng thành công.',
            imported: importedCount,
            updated: updatedCount
        });

    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi import khách hàng:', error);
        res.status(500).json({ message: 'Lỗi hệ thống khi import khách hàng.' });
    } finally {
        connection.release();
    }
};


// Lấy danh sách chi nhánh (cho dropdown trong form)
const fetchBranches = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.roles && req.user.roles.some(role => role.name === 'admin');

        let query = `SELECT id, name FROM branches`;
        const params = [];

        if (!isAdmin && userBranchIds.length > 0) {
            query += ` WHERE id IN (${userBranchIds.map(() => '?').join(',')})`;
            params.push(...userBranchIds);
        } else if (!isAdmin && userBranchIds.length === 0) {
            // If not admin and no branches assigned, return empty array
            return res.json([]);
        }

        const [rows] = await connection.execute(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách chi nhánh:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách chi nhánh.' });
    } finally {
        connection.release();
    }
};


module.exports = {
    index,
    show,
    store,
    update,
    destroy,
    getBranchesList,
    exportCustomers,
    importCustomers,
    fetchBranches
};
