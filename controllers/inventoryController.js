// duongbackend/controllers/inventoryController.js

const { pool } = require('../config/db');

// Helper function to get product details with stock for a specific branch
// This is a more detailed version than what might be in productController if needed
const getProductDetailsWithStock = async (connection, productId, userBranchIds, isAdmin) => {
    let query = `
        SELECT
            p.id, p.name, p.sku, p.barcode, p.image_url, p.base_price, p.unit, p.track_stock, p.active,
            c.name AS category_name, c.id AS category_id,
            GROUP_CONCAT(DISTINCT ps.branch_id) AS stock_branch_ids_csv,
            GROUP_CONCAT(DISTINCT CONCAT(b.name, ':', ps.stock, ':', ps.low_stock_threshold) ORDER BY b.name SEPARATOR ';') AS stock_details_csv
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN product_stocks ps ON p.id = ps.product_id
        LEFT JOIN branches b ON ps.branch_id = b.id
        WHERE p.id = ?
    `;
    let params = [productId];

    if (!isAdmin && userBranchIds && userBranchIds.length > 0) {
        // Use IN (?) and push the array directly for mysql2 to expand
        query += ` AND ps.branch_id IN (?)`;
        params.push(userBranchIds); // Push the array directly
    } else if (!isAdmin && (!userBranchIds || userBranchIds.length === 0)) {
        // If not admin and no branches, they shouldn't see any stock
        return null;
    }

    query += ` GROUP BY p.id`;

    const [rows] = await connection.execute(query, params);

    if (rows.length === 0) return null;

    const product = rows[0];
    const productStocks = [];

    if (product.stock_details_csv) {
        product.stock_details_csv.split(';').forEach(detail => {
            const parts = detail.split(':');
            if (parts.length === 3) {
                const branchName = parts[0];
                const stock = parseInt(parts[1]);
                const lowStockThreshold = parseInt(parts[2]);
                // Need to get branch_id from branchName, this is inefficient.
                // Better to return branch_id directly from query.
                // Let's modify the query to return branch_id directly.
            }
        });
    }

    // REVISED getProductDetailsWithStock to return branch_id directly
    const [stockRows] = await connection.execute(
        `SELECT ps.id, ps.branch_id, b.name as branch_name, ps.stock, ps.low_stock_threshold, ps.available, ps.price_override
         FROM product_stocks ps
         JOIN branches b ON ps.branch_id = b.id
         WHERE ps.product_id = ?
         ${!isAdmin && userBranchIds && userBranchIds.length > 0 ? `AND ps.branch_id IN (?)` : ''}
        `,
        [productId, ...(!isAdmin && userBranchIds && userBranchIds.length > 0 ? [userBranchIds] : [])] // Wrap userBranchIds in an array if it's an array for IN (?)
    );

    return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        image_url: product.image_url,
        base_price: product.base_price,
        unit: product.unit,
        track_stock: product.track_stock,
        active: product.active,
        category: { id: product.category_id, name: product.category_name },
        product_stocks: stockRows // This will be the array of stock objects
    };
};

// [GET] Lấy danh sách tồn kho sản phẩm theo chi nhánh (có thể lọc)
const getInventorySummary = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { search, category_id, branch_id, page = 1, per_page = 10 } = req.query;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions?.includes('admin_global');

        // Validate và chuyển đổi tham số phân trang
        const currentPage = Math.max(1, parseInt(page)) || 1;
        const itemsPerPage = Math.max(1, parseInt(per_page)) || 10;
        const offset = (currentPage - 1) * itemsPerPage;

        // Xử lý branch_ids
        let effectiveBranchIds = [];
        if (!isAdmin) {
            effectiveBranchIds = (Array.isArray(userBranchIds) ? userBranchIds : [userBranchIds])
                .map(id => parseInt(id))
                .filter(id => !isNaN(id) && id > 0);
            
            if (effectiveBranchIds.length === 0) {
                return res.json({ data: [], total: 0, current_page: currentPage, last_page: 1 });
            }
        }

        // Xử lý branch_id filter nếu được chỉ định
        if (branch_id && branch_id !== 'all') {
            const parsedBranchId = parseInt(branch_id);
            if (!isNaN(parsedBranchId)) {
                if (!isAdmin && !effectiveBranchIds.includes(parsedBranchId)) {
                    return res.status(403).json({ message: 'Không có quyền truy cập chi nhánh này' });
                }
                effectiveBranchIds = [parsedBranchId];
            }
        }

        // Xây dựng điều kiện WHERE
        const whereClauses = [];
        const queryParams = [];

        // Thêm điều kiện tìm kiếm
        if (search) {
            whereClauses.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
            queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        // Thêm điều kiện category
        if (category_id && category_id !== 'all') {
            const parsedCategoryId = parseInt(category_id);
            if (!isNaN(parsedCategoryId)) {
                whereClauses.push('p.category_id = ?');
                queryParams.push(parsedCategoryId);
            }
        }

        // Xử lý điều kiện branch - QUAN TRỌNG
        let branchConditionAdded = false;
        if (effectiveBranchIds.length > 0) {
            whereClauses.push(`ps.branch_id IN (${effectiveBranchIds.map(() => '?').join(',')})`);
            queryParams.push(...effectiveBranchIds);
            branchConditionAdded = true;
        } else if (!isAdmin) {
            return res.json({ data: [], total: 0, current_page: currentPage, last_page: 1 });
        }

        const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Truy vấn đếm tổng số bản ghi
        const countQuery = `
            SELECT COUNT(DISTINCT p.id) AS total
            FROM products p
            LEFT JOIN product_stocks ps ON p.id = ps.product_id
            LEFT JOIN categories c ON p.category_id = c.id
            ${whereSQL}
        `;

        const [countRows] = await connection.query(countQuery, queryParams);
        const total = countRows[0]?.total || 0;

        // Truy vấn dữ liệu - SỬ DỤNG connection.query THAY VÌ execute
        const dataQuery = `
            SELECT
                p.id, p.name, p.sku, p.barcode, p.image_url, p.base_price, p.unit, 
                p.track_stock, p.active,
                c.name AS category_name, c.id AS category_id,
                GROUP_CONCAT(DISTINCT 
                    CONCAT(ps.branch_id, ':', b.name, ':', ps.stock, ':', ps.low_stock_threshold) 
                    ORDER BY b.name SEPARATOR ';'
                ) AS product_stocks_csv
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN product_stocks ps ON p.id = ps.product_id
            LEFT JOIN branches b ON ps.branch_id = b.id
            ${whereSQL}
            GROUP BY p.id
            ORDER BY p.name ASC
            LIMIT ?, ?
        `;

        // Thực thi với tất cả tham số
        const [rows] = await connection.query(dataQuery, [...queryParams, offset, itemsPerPage]);

        // Xử lý kết quả
        const products = rows.map(row => ({
            id: row.id,
            name: row.name,
            sku: row.sku,
            barcode: row.barcode,
            image_url: row.image_url,
            base_price: row.base_price,
            unit: row.unit,
            track_stock: row.track_stock,
            active: row.active,
            category: { 
                id: row.category_id, 
                name: row.category_name 
            },
            product_stocks: row.product_stocks_csv 
                ? row.product_stocks_csv.split(';').map(detail => {
                    const [branch_id, branch_name, stock, low_stock_threshold] = detail.split(':');
                    return {
                        branch_id: parseInt(branch_id),
                        branch_name,
                        stock: parseInt(stock),
                        low_stock_threshold: parseInt(low_stock_threshold)
                    };
                })
                : []
        }));

        res.json({
            data: products,
            total,
            current_page: currentPage,
            last_page: Math.ceil(total / itemsPerPage)
        });

    } catch (error) {
        console.error('Error fetching inventory summary:', {
            message: error.message,
            sql: error.sql,
            stack: error.stack
        });
        res.status(500).json({ 
            message: 'Lỗi server khi lấy tổng quan tồn kho',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        connection.release();
    }
};
// [POST] Điều chỉnh tồn kho thủ công (tăng/giảm)
const adjustStock = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { product_id, branch_id, quantity, type, reason } = req.body;
        console.log('Adjust Stock Request Body:', { product_id, branch_id, quantity, type, reason }); //

        // Validate inputs
        if (!product_id || !branch_id || quantity === undefined || quantity <= 0 || !type || !['increase', 'decrease', 'import', 'export'].includes(type)) {
            console.log('Invalid input for stock adjustment.'); //
            return res.status(400).json({ message: 'Dữ liệu điều chỉnh tồn kho không hợp lệ.' });
        }

        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions && req.user.permissions.includes('admin_global');
        console.log('User Branch IDs:', userBranchIds, 'Is Admin:', isAdmin); //

        // Kiểm tra quyền của người dùng đối với chi nhánh
        if (!isAdmin && !userBranchIds.includes(parseInt(branch_id))) {
            await connection.rollback();
            console.log('User not authorized for this branch.'); //
            return res.status(403).json({ message: 'Bạn không có quyền điều chỉnh tồn kho cho chi nhánh này.' });
        }

        // Lấy thông tin tồn kho hiện tại
        const [stockRows] = await connection.execute(
            'SELECT id, stock FROM product_stocks WHERE product_id = ? AND branch_id = ?',
            [product_id, branch_id]
        );
        console.log('Current Stock Rows:', stockRows); //

        let stockId;
        let currentStock;

        if (stockRows.length === 0) {
            if (type === 'decrease' || type === 'export') {
                await connection.rollback();
                console.log('Cannot decrease/export, no stock found.'); //
                return res.status(400).json({ message: 'Không thể giảm/xuất kho vì sản phẩm chưa có tồn kho tại chi nhánh này.' });
            }
            const [insertResult] = await connection.execute(
                'INSERT INTO product_stocks (product_id, branch_id, stock, low_stock_threshold, available) VALUES (?, ?, ?, ?, ?)',
                [product_id, branch_id, 0, 5, 1]
            );
            stockId = insertResult.insertId;
            currentStock = 0;
            console.log('New stock record created:', stockId); //
        } else {
            stockId = stockRows[0].id;
            currentStock = stockRows[0].stock;
        }
        console.log('Stock ID:', stockId, 'Current Stock:', currentStock); //

        let newStock;

        if (type === 'increase' || type === 'import') {
            newStock = currentStock + quantity;
        } else {
            newStock = currentStock - quantity;
            if (newStock < 0) {
                await connection.rollback();
                console.log('New stock would be negative.'); //
                return res.status(400).json({ message: 'Số lượng tồn kho không thể âm.' });
            }
        }
        console.log('Calculated New Stock:', newStock); //

        // Cập nhật tồn kho trong bảng product_stocks
        const [updateResult] = await connection.execute( // Add [updateResult] to check affected rows
            'UPDATE product_stocks SET stock = ?, updated_at = NOW() WHERE id = ?',
            [newStock, stockId]
        );
        console.log('Stock Update Result (affectedRows):', updateResult.affectedRows); //

        // Ghi lại giao dịch trong bảng inventory_transactions
        await connection.execute(
            'INSERT INTO inventory_transactions (product_id, branch_id, quantity, type, current_stock, new_stock, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [product_id, branch_id, quantity, type, currentStock, newStock, req.user.id, reason || 'Điều chỉnh thủ công']
        );
        console.log('Inventory transaction logged.'); //

        await connection.commit();
        console.log('Transaction committed successfully.'); //
        res.status(200).json({ message: 'Điều chỉnh tồn kho thành công.', new_stock: newStock });

    } catch (error) {
        await connection.rollback();
        console.error('Error adjusting stock:', { // Improved error logging
            message: error.message,
            sql: error.sql, // Log SQL if available
            stack: error.stack
        });
        res.status(500).json({
            message: 'Lỗi server khi điều chỉnh tồn kho.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        connection.release();
    }
};


// [POST] Chuyển kho sản phẩm
const transferStock = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { product_id, from_branch_id, to_branch_id, quantity, reason } = req.body;

        // Kiểm tra dữ liệu đầu vào
        if (!product_id || !from_branch_id || !to_branch_id || quantity === undefined || quantity <= 0 || from_branch_id === to_branch_id) {
            return res.status(400).json({ message: 'Dữ liệu chuyển kho không hợp lệ.' });
        }

        // Giới hạn độ dài của reason (nếu có)
        const maxReasonLength = 255;
        if (reason && reason.length > maxReasonLength) {
            return res.status(400).json({ message: 'Reason quá dài, không thể xử lý.' });
        }

        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions && req.user.permissions.includes('admin_global');

        // Kiểm tra quyền của người dùng đối với cả chi nhánh nguồn và đích
        if (!isAdmin && (!userBranchIds.includes(parseInt(from_branch_id)) || !userBranchIds.includes(parseInt(to_branch_id)))) {
            await connection.rollback();
            return res.status(403).json({ message: 'Bạn không có quyền chuyển kho giữa các chi nhánh này.' });
        }

        // Lấy tồn kho tại chi nhánh nguồn
        const [fromStockRows] = await connection.execute(
            'SELECT id, stock FROM product_stocks WHERE product_id = ? AND branch_id = ?',
            [product_id, from_branch_id]
        );

        if (fromStockRows.length === 0 || fromStockRows[0].stock < quantity) {
            await connection.rollback();
            return res.status(400).json({ message: 'Tồn kho tại chi nhánh nguồn không đủ để thực hiện chuyển kho.' });
        }

        const fromStockId = fromStockRows[0].id;
        const currentFromStock = fromStockRows[0].stock;
        const newFromStock = currentFromStock - quantity;

        // Lấy hoặc tạo tồn kho tại chi nhánh đích
        let [toStockRows] = await connection.execute(
            'SELECT id, stock FROM product_stocks WHERE product_id = ? AND branch_id = ?',
            [product_id, to_branch_id]
        );

        let toStockId;
        let currentToStock;
        let newToStock;

        if (toStockRows.length === 0) {
            // Nếu chưa có tồn kho tại chi nhánh đích, tạo mới
            const [insertResult] = await connection.execute(
                'INSERT INTO product_stocks (product_id, branch_id, stock, low_stock_threshold, available) VALUES (?, ?, ?, ?, ?)',
                [product_id, to_branch_id, quantity, 5, 1] // Mặc định ngưỡng thấp 5, available 1
            );
            toStockId = insertResult.insertId;
            currentToStock = 0;
            newToStock = quantity;
        } else {
            toStockId = toStockRows[0].id;
            currentToStock = toStockRows[0].stock;
            newToStock = currentToStock + quantity;
        }

        // Cập nhật tồn kho chi nhánh nguồn
        await connection.execute(
            'UPDATE product_stocks SET stock = ?, updated_at = NOW() WHERE id = ?',
            [newFromStock, fromStockId]
        );

        // Cập nhật tồn kho chi nhánh đích
        await connection.execute(
            'UPDATE product_stocks SET stock = ?, updated_at = NOW() WHERE id = ?',
            [newToStock, toStockId]
        );

        // Ghi lại giao dịch chuyển kho (2 bản ghi: giảm ở nguồn, tăng ở đích)
        await connection.execute(
            'INSERT INTO inventory_transactions (product_id, branch_id, quantity, type, current_stock, new_stock, user_id, reason, related_transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [product_id, from_branch_id, quantity, 'transfer_out', currentFromStock, newFromStock, req.user.id, reason || 'Chuyển kho', null] // Null cho related_transaction_id ở bước đầu
        );
        const transferOutId = (await connection.execute('SELECT LAST_INSERT_ID() as id'))[0][0].id;

        await connection.execute(
            'INSERT INTO inventory_transactions (product_id, branch_id, quantity, type, current_stock, new_stock, user_id, reason, related_transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [product_id, to_branch_id, quantity, 'transfer_in', currentToStock, newToStock, req.user.id, reason || 'Chuyển kho', transferOutId]
        );
        const transferInId = (await connection.execute('SELECT LAST_INSERT_ID() as id'))[0][0].id;

        // Cập nhật lại related_transaction_id cho bản ghi transfer_out
        await connection.execute(
            'UPDATE inventory_transactions SET related_transaction_id = ? WHERE id = ?',
            [transferInId, transferOutId]
        );

        await connection.commit();
        res.status(200).json({ message: 'Chuyển kho thành công.', new_from_stock: newFromStock, new_to_stock: newToStock });

    } catch (error) {
        await connection.rollback();
        console.error('Error transferring stock:', error);
        res.status(500).json({ message: 'Lỗi server khi chuyển kho.', error: error.message });
    } finally {
        connection.release();
    }
};


// [GET] Lấy lịch sử giao dịch tồn kho
const getInventoryTransactions = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { product_id, branch_id, type, start_date, end_date, page = 1, per_page = 10 } = req.query;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions && req.user.permissions.includes('admin_global');

        let countQuery = `
            SELECT COUNT(*) as total
            FROM inventory_transactions it
            LEFT JOIN products p ON it.product_id = p.id
            LEFT JOIN branches b ON it.branch_id = b.id
            LEFT JOIN users u ON it.user_id = u.id
        `;
        let dataQuery = `
            SELECT
                it.id, it.product_id, p.name AS product_name, p.sku AS product_sku,
                it.branch_id, b.name AS branch_name,
                it.quantity, it.type, it.current_stock, it.new_stock,
                it.user_id, u.name AS user_name,
                it.reason, it.related_transaction_id, it.created_at
            FROM inventory_transactions it
            LEFT JOIN products p ON it.product_id = p.id
            LEFT JOIN branches b ON it.branch_id = b.id
            LEFT JOIN users u ON it.user_id = u.id
        `;

        let whereClauses = [];
        let params = [];
        let countParams = [];

        if (product_id) {
            whereClauses.push('it.product_id = ?');
            params.push(product_id);
            countParams.push(product_id);
        }
        if (branch_id && branch_id !== 'all' && branch_id !== '') {
            whereClauses.push(`EXISTS (
                SELECT 1 FROM product_stocks ps_filter
                WHERE ps_filter.product_id = p.id AND ps_filter.branch_id = ?
            )`);
            params.push(branch_id);
            countParams.push(branch_id);
        }
        if (type) {
            whereClauses.push('it.type = ?');
            params.push(type);
            countParams.push(type);
        }
        if (start_date) {
            whereClauses.push('it.created_at >= ?');
            params.push(start_date);
            countParams.push(start_date);
        }
        if (end_date) {
            whereClauses.push('it.created_at <= ?');
            params.push(end_date);
            countParams.push(end_date);
        }

        // Apply branch filter based on user's branches
        if (!isAdmin && userBranchIds.length > 0) {
            whereClauses.push(`it.branch_id IN (?)`); // Use IN (?)
            params.push(userBranchIds); // Push the array directly
            countParams.push(userBranchIds); // Push the array directly
        } else if (!isAdmin && userBranchIds.length === 0) {
            // If not admin and no branches, cannot see any transactions
            return res.json({ data: [], total: 0, current_page: 1, last_page: 1 });
        }

        if (whereClauses.length > 0) {
            countQuery += ` WHERE ` + whereClauses.join(' AND ');
            dataQuery += ` WHERE ` + whereClauses.join(' AND ');
        }

        const [countRows] = await connection.execute(countQuery, countParams);
        const total = countRows[0].total;

        const offset = (page - 1) * per_page;
        dataQuery += ` ORDER BY it.created_at DESC LIMIT ?, ?`;
        params.push(offset, parseInt(per_page));

        const [rows] = await connection.execute(dataQuery, params);

        res.json({
            data: rows,
            total: total,
            current_page: parseInt(page),
            last_page: Math.ceil(total / per_page)
        });

    } catch (error) {
        console.error('Error fetching inventory transactions:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy lịch sử giao dịch tồn kho.' });
    } finally {
        connection.release();
    }
};

// [GET] Lấy danh sách sản phẩm (đơn giản, chỉ ID và tên) để dùng trong dropdown
const getSimpleProductsList = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions && req.user.permissions.includes('admin_global');

        let query = `
            SELECT DISTINCT p.id, p.name, p.sku
            FROM products p
            LEFT JOIN product_stocks ps ON p.id = ps.product_id
        `;
        let params = [];

        // Nếu người dùng không phải admin và có chi nhánh hợp lệ
        if (!isAdmin && userBranchIds.length > 0) {
            // Sử dụng tham số mảng cho câu lệnh SQL IN
            query += ` WHERE ps.branch_id IN (${userBranchIds.map(() => '?').join(', ')})`;
            params = [...userBranchIds]; // Truyền mảng chi nhánh vào params
        } else if (!isAdmin && userBranchIds.length === 0) {
            return res.json([]);
        }

        query += ` ORDER BY p.name ASC`;

        // Thực thi câu lệnh SQL
        const [rows] = await connection.execute(query, params);
        res.json(rows);

    } catch (error) {
        console.error('Error fetching simple products list:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách sản phẩm.' });
    } finally {
        connection.release(); // Giải phóng kết nối
    }
};


// [GET] Lấy danh sách chi nhánh (đơn giản, chỉ ID và tên) để dùng trong dropdown
const getSimpleBranchesList = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions && req.user.permissions.includes('admin_global');

        let query = `SELECT id, name FROM branches`;
        let params = [];

        if (!isAdmin && userBranchIds.length > 0) {
            query += ` WHERE id IN (?)`; // Use IN (?)
            params.push(userBranchIds); // Push the array directly
        } else if (!isAdmin && userBranchIds.length === 0) {
            return res.json([]);
        }

        query += ` ORDER BY name ASC`;

        const [rows] = await connection.execute(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching simple branches list:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách chi nhánh.' });
    } finally {
        connection.release();
    }
};

module.exports = {
    getInventorySummary,
    adjustStock,
    transferStock,
    getInventoryTransactions,
    getSimpleProductsList,
    getSimpleBranchesList
};
