const { pool } = require('../config/db');
const xlsx = require('xlsx'); // Cần cài đặt: npm install xlsx

// Lấy tất cả đơn hàng (có phân trang, tìm kiếm, lọc)
const index = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { search, status, branch_id, start_date, end_date, page = 1, per_page = 10 } = req.query;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions.includes('admin_access');

        // Validate and convert parameters
        const currentPage = Math.max(1, parseInt(page)) || 1;
        const itemsPerPage = Math.max(1, parseInt(per_page)) || 10;
        const offset = (currentPage - 1) * itemsPerPage;

        let whereClauses = [];
        let queryParams = [];
        let countParams = [];

        // Branch filtering logic
        if (!isAdmin && userBranchIds.length === 0) {
            return res.status(200).json({ 
                orders: [], 
                total: 0, 
                current_page: currentPage, 
                last_page: 0 
            });
        }

        if (branch_id && branch_id !== 'all') {
            const branchIdNum = parseInt(branch_id);
            if (isNaN(branchIdNum)) {
                return res.status(400).json({ message: 'ID chi nhánh không hợp lệ.' });
            }
        
            if (!isAdmin && !userBranchIds.includes(branchIdNum)) {
                return res.status(403).json({ 
                    message: 'Bạn không có quyền truy cập chi nhánh này.',
                    user_branches: userBranchIds
                });
            }
        
            whereClauses.push(`o.branch_id = ?`);
            queryParams.push(branchIdNum);
            countParams.push(branchIdNum);
        } else if (!isAdmin) {
            if (userBranchIds.length === 0) {
                return res.status(200).json({ orders: [], total: 0, current_page: 1, last_page: 0 });
            }
            whereClauses.push(`o.branch_id IN (${userBranchIds.map(() => '?').join(',')})`);
            queryParams.push(...userBranchIds);
            countParams.push(...userBranchIds);
        }

        // Other filters
        if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(o.id LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)`); 
            queryParams.push(searchTerm, searchTerm, searchTerm);
            countParams.push(searchTerm, searchTerm, searchTerm);
        }

        if (status && status !== 'all') {
            whereClauses.push(`o.status = ?`);
            queryParams.push(status);
            countParams.push(status);
        }

        if (start_date) {
            whereClauses.push(`DATE(o.created_at) >= ?`);
            queryParams.push(start_date);
            countParams.push(start_date);
        }
        if (end_date) {
            whereClauses.push(`DATE(o.created_at) <= ?`);
            queryParams.push(end_date);
            countParams.push(end_date);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Count total orders
        const countQuery = `
            SELECT COUNT(o.id) AS total
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            LEFT JOIN branches b ON o.branch_id = b.id
            ${whereSql}
        `;
        const [countRows] = await connection.execute(countQuery, countParams);
        const total = countRows[0]?.total || 0;
        const lastPage = Math.ceil(total / itemsPerPage);

        // Get orders with pagination
        const ordersQuery = `
            SELECT
                o.id, o.customer_id, c.name AS customer_name, c.phone AS customer_phone,
                o.branch_id, b.name AS branch_name, o.total_amount, o.paid_amount,
                o.change_amount, o.payment_method, o.status, o.notes,
                o.created_at, o.updated_at
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            LEFT JOIN branches b ON o.branch_id = b.id
            ${whereSql}
            ORDER BY o.created_at DESC
            LIMIT ? OFFSET ?
        `;
        
        // Combine query params with pagination params
        const finalQueryParams = [...queryParams, itemsPerPage.toString(), offset.toString()];
        const [orders] = await connection.execute(ordersQuery, finalQueryParams);

        // Get additional details for each order
        for (const order of orders) {
            // Get order items
            const [items] = await connection.execute(
                `SELECT oi.*, p.sku, p.track_stock, p.sold_by_weight
                 FROM order_items oi
                 LEFT JOIN products p ON oi.product_id = p.id
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            order.items = items;

            // Get returns if any
            const [returns] = await connection.execute(
                `SELECT * FROM returns WHERE order_id = ?`,
                [order.id]
            );
            order.returns = returns;

            // Get customer details if exists
            if (order.customer_id) {
                const [customerRows] = await connection.execute(
                    `SELECT id, name, phone, email, address FROM customers WHERE id = ?`,
                    [order.customer_id]
                );
                order.customer = customerRows[0] || null;
            } else {
                order.customer = null;
            }
        }

        res.json({
            orders,
            total,
            per_page: itemsPerPage,
            current_page: currentPage,
            last_page: lastPage
        });

    } catch (error) {
        console.error('Lỗi khi tải danh sách đơn hàng:', {
            message: error.message,
            sql: error.sql,
            stack: error.stack
        });
        res.status(500).json({ 
            message: 'Lỗi server khi tải danh sách đơn hàng.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        connection.release();
    }
};

// Lấy chi tiết một đơn hàng cụ thể
const show = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions.includes('admin_access');

        // Lấy thông tin đơn hàng
        const [orders] = await connection.execute(
            `SELECT
                o.id, o.customer_id, c.name AS customer_name, c.phone AS customer_phone,
                o.branch_id, b.name AS branch_name, o.total_amount, o.paid_amount,
                o.change_amount, o.payment_method, o.status, o.notes,
                o.created_at, o.updated_at
             FROM orders o
             LEFT JOIN customers c ON o.customer_id = c.id
             LEFT JOIN branches b ON o.branch_id = b.id
             WHERE o.id = ?`,
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
        }

        const order = orders[0];

        // Kiểm tra quyền truy cập chi nhánh của đơn hàng
        if (!isAdmin && !userBranchIds.includes(order.branch_id)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem đơn hàng này.' });
        }

        // Lấy chi tiết sản phẩm trong đơn hàng
        const [items] = await connection.execute(
            `SELECT oi.*, p.sku, p.track_stock, p.sold_by_weight
             FROM order_items oi
             LEFT JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = ?`,
            [order.id]
        );
        order.items = items;

        // Lấy thông tin trả hàng liên quan
        const [returns] = await connection.execute(
            `SELECT * FROM returns WHERE order_id = ?`,
            [order.id]
        );
        order.returns = returns;

        // Lấy thông tin khách hàng nếu có customer_id
        if (order.customer_id) {
            const [customerRows] = await connection.execute(
                `SELECT id, name, phone, email, address FROM customers WHERE id = ?`,
                [order.customer_id]
            );
            order.customer = customerRows[0] || null;
        } else {
            order.customer = null;
        }

        res.json(order);

    } catch (error) {
        console.error('Lỗi khi tải chi tiết đơn hàng:', error);
        res.status(500).json({ message: 'Lỗi server khi tải chi tiết đơn hàng.', error: error.message });
    } finally {
        connection.release();
    }
};

// Cập nhật trạng thái đơn hàng
const updateStatus = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions.includes('admin_access');

        if (!['pending', 'completed', 'cancelled', 'returned'].includes(status)) {
            return res.status(400).json({ message: 'Trạng thái không hợp lệ.' });
        }

        // Kiểm tra quyền truy cập chi nhánh của đơn hàng trước khi cập nhật
        const [orders] = await connection.execute(
            `SELECT branch_id FROM orders WHERE id = ?`,
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
        }

        const orderBranchId = orders[0].branch_id;
        if (!isAdmin && !userBranchIds.includes(orderBranchId)) {
            return res.status(403).json({ message: 'Bạn không có quyền cập nhật đơn hàng này.' });
        }

        await connection.execute(
            `UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?`,
            [status, id]
        );

        res.json({ message: 'Cập nhật trạng thái đơn hàng thành công.' });

    } catch (error) {
        console.error('Lỗi khi cập nhật trạng thái đơn hàng:', error);
        res.status(500).json({ message: 'Lỗi server khi cập nhật trạng thái đơn hàng.', error: error.message });
    } finally {
        connection.release();
    }
};

// Xử lý tạo bản ghi trả hàng
const createReturn = async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
        const { order_id, customer_id, branch_id, total_refund_amount, reason, items } = req.body;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions.includes('admin_access');

        // Basic validation
        if (!order_id || !branch_id || !total_refund_amount || !items || items.length === 0) {
            return res.status(400).json({ message: 'Dữ liệu trả hàng không hợp lệ.' });
        }

        // Kiểm tra quyền truy cập chi nhánh
        if (!isAdmin && !userBranchIds.includes(branch_id)) {
            return res.status(403).json({ message: 'Bạn không có quyền xử lý trả hàng cho chi nhánh này.' });
        }

        // Kiểm tra trạng thái đơn hàng gốc
        const [orderRows] = await connection.execute(
            `SELECT status FROM orders WHERE id = ?`,
            [order_id]
        );
        if (orderRows.length === 0 || orderRows[0].status !== 'completed') {
            return res.status(400).json({ message: 'Chỉ có thể trả hàng cho đơn hàng đã hoàn thành.' });
        }

        // Tạo bản ghi trả hàng chính
        const [returnResult] = await connection.execute(
            `INSERT INTO returns (order_id, customer_id, branch_id, total_refund_amount, reason, return_date, return_status)
             VALUES (?, ?, ?, ?, ?, NOW(), 'completed')`,
            [order_id, customer_id, branch_id, total_refund_amount, reason]
        );
        const returnId = returnResult.insertId;

        // Thêm các sản phẩm trả hàng
        for (const item of items) {
            const { order_item_id, product_id, quantity, unit_price, product_name_at_return, track_stock, sold_by_weight } = item;

            if (quantity <= 0) continue;

            await connection.execute(
                `INSERT INTO return_items (return_id, order_item_id, product_id, quantity, unit_price_at_return, product_name_at_return, refund_amount)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [returnId, order_item_id, product_id, quantity, unit_price, product_name_at_return, quantity * unit_price]
            );

            // Cập nhật số lượng tồn kho nếu sản phẩm được theo dõi kho
            if (track_stock) {
                const stockAdjustmentQuantity = sold_by_weight ? quantity : quantity;
                
                // First update the stock
                await connection.execute(
                    `UPDATE product_stocks SET stock = stock + ? WHERE product_id = ? AND branch_id = ?`,
                    [stockAdjustmentQuantity, product_id, branch_id]
                );

                // Then get the new stock level and insert into history
                const [stockRows] = await connection.execute(
                    `SELECT stock FROM product_stocks WHERE product_id = ? AND branch_id = ?`,
                    [product_id, branch_id]
                );
                
                if (stockRows.length > 0) {
                    const newStockLevel = stockRows[0].stock;
                    await connection.execute(
                        `INSERT INTO stock_history 
                        (product_id, branch_id, change_type, quantity_change, new_stock_level, reference_id, reference_type, user_id, notes)
                        VALUES (?, ?, 'return', ?, ?, ?, 'return', ?, ?)`,
                        [product_id, branch_id, stockAdjustmentQuantity, newStockLevel, returnId, req.user.id, 'Trả hàng từ đơn hàng']
                    );
                }
            }
        }

        // Cập nhật trạng thái đơn hàng gốc
        await connection.execute(
            `UPDATE orders SET status = 'returned', total_refunded_amount = total_refunded_amount + ?, updated_at = NOW() WHERE id = ?`,
            [total_refund_amount, order_id]
        );

        await connection.commit();
        res.status(201).json({ message: 'Xử lý trả hàng thành công.', returnId });

    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi xử lý trả hàng:', error);
        res.status(500).json({ 
            message: 'Lỗi server khi xử lý trả hàng.', 
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        connection.release();
    }
};

// Export đơn hàng ra Excel
const exportOrders = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { search, status, branch_id, start_date, end_date } = req.query;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions.includes('admin_access');

        let whereClauses = [];
        let queryParams = [];

        // Xác định các chi nhánh hiệu quả để lọc (tương tự hàm index)
        let effectiveBranchIds = [];
        if (isAdmin) {
            if (branch_id && branch_id !== 'all') {
                const requestedBranchIdNum = parseInt(branch_id);
                if (isNaN(requestedBranchIdNum)) {
                    return res.status(400).json({ message: 'ID chi nhánh không hợp lệ.' });
                }
                effectiveBranchIds = [requestedBranchIdNum];
            }
        } else {
            if (userBranchIds.length === 0) {
                const workbook = xlsx.utils.book_new();
                xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([]), 'Danh sách Đơn hàng');
                const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
                res.setHeader('Content-Disposition', 'attachment; filename=danh_sach_don_hang.xlsx');
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                return res.send(buffer);
            }

            if (branch_id && branch_id !== 'all') {
                const requestedBranchIdNum = parseInt(branch_id);
                if (isNaN(requestedBranchIdNum) || !userBranchIds.includes(requestedBranchIdNum)) {
                    return res.status(403).json({ message: 'Bạn không có quyền truy cập chi nhánh này hoặc ID chi nhánh không hợp lệ.' });
                }
                effectiveBranchIds = [requestedBranchIdNum];
            } else {
                effectiveBranchIds = userBranchIds;
            }
        }

        if (effectiveBranchIds.length > 0) {
            whereClauses.push(`o.branch_id IN (?)`);
            queryParams.push(effectiveBranchIds);
        }

        if (search) {
            whereClauses.push(`(o.id LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)`);
            queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (status) {
            whereClauses.push(`o.status = ?`);
            queryParams.push(status);
        }

        if (start_date) {
            whereClauses.push(`DATE(o.created_at) >= ?`);
            queryParams.push(start_date);
        }
        if (end_date) {
            whereClauses.push(`DATE(o.created_at) <= ?`);
            queryParams.push(end_date);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const [orders] = await connection.execute(
            `SELECT
                o.id AS 'Mã Đơn',
                COALESCE(c.name, 'Khách vãng lai') AS 'Tên Khách hàng',
                COALESCE(c.phone, 'N/A') AS 'SĐT Khách hàng',
                b.name AS 'Chi nhánh',
                o.total_amount AS 'Tổng tiền',
                o.paid_amount AS 'Đã thanh toán',
                o.change_amount AS 'Tiền thừa',
                o.payment_method AS 'PTTT',
                CASE o.status
                    WHEN 'pending' THEN 'Đang chờ xử lý'
                    WHEN 'completed' THEN 'Hoàn thành'
                    WHEN 'cancelled' THEN 'Đã hủy'
                    WHEN 'returned' THEN 'Đã trả hàng'
                    ELSE 'Không xác định'
                END AS 'Trạng thái',
                o.notes AS 'Ghi chú',
                DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s') AS 'Ngày tạo',
                DATE_FORMAT(o.updated_at, '%Y-%m-%d %H:%i:%s') AS 'Ngày cập nhật'
             FROM orders o
             LEFT JOIN customers c ON o.customer_id = c.id
             LEFT JOIN branches b ON o.branch_id = b.id
             ${whereSql}
             ORDER BY o.created_at DESC`,
            queryParams
        );

        const rowsForExcel = [];
        for (const order of orders) {
            const [items] = await connection.execute(
                `SELECT oi.product_name_at_time_of_order, oi.quantity, oi.unit_price, oi.subtotal, oi.modifiers_options_notes
                 FROM order_items oi
                 WHERE oi.order_id = ?`,
                [order['Mã Đơn']]
            );

            const [returns] = await connection.execute(
                `SELECT ri.product_name_at_return, ri.quantity, ri.refund_amount, r.reason, r.return_date
                 FROM return_items ri
                 JOIN returns r ON ri.return_id = r.id
                 WHERE ri.order_id = ?`,
                [order['Mã Đơn']]
            );

            rowsForExcel.push({
                ...order,
                'Sản phẩm trong đơn': items.map(item => `${item.product_name_at_time_of_order} (SL: ${item.quantity}, Giá: ${item.unit_price}, TT: ${item.subtotal}, Ghi chú: ${item.modifiers_options_notes || 'N/A'})`).join('; '),
                'Thông tin trả hàng': returns.map(ret => `SP: ${ret.product_name_at_return} (SL trả: ${ret.quantity}, Hoàn: ${ret.refund_amount}, Lý do: ${ret.reason || 'N/A'}, Ngày trả: ${ret.return_date})`).join('; ')
            });
        }

        const worksheet = xlsx.utils.json_to_sheet(rowsForExcel);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Danh sách Đơn hàng');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename=danh_sach_don_hang.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        console.error('Lỗi khi xuất đơn hàng:', error);
        res.status(500).json({ message: 'Lỗi server khi xuất đơn hàng.', error: error.message });
    } finally {
        connection.release();
    }
};

module.exports = {
    index,
    show,
    updateStatus,
    createReturn,
    exportOrders
};
