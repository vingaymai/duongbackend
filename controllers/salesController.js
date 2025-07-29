// duongbackend/controllers/salesController.js

const { pool } = require('../config/db');

/**
 * [GET] Lấy danh sách sản phẩm cho màn hình bán hàng (POS).
 * Bao gồm thông tin tồn kho tại chi nhánh được chọn của người dùng.
 *
 * @param {object} req - Đối tượng request, chứa query params (search, branch_id, active_only) và thông tin người dùng (req.user).
 * @param {object} res - Đối tượng response.
 */
const getSalesProducts = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { search, branch_id, active_only } = req.query;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions?.includes('admin_global');

        // Validate branch_id
        if (!branch_id) {
            return res.status(400).json({ message: 'Vui lòng cung cấp ID chi nhánh.' });
        }
        
        const parsedBranchId = parseInt(branch_id);
        if (isNaN(parsedBranchId)) {
            return res.status(400).json({ message: 'ID chi nhánh không hợp lệ.' });
        }

        // Kiểm tra quyền truy cập chi nhánh
        if (!isAdmin && !userBranchIds.includes(parsedBranchId)) {
            return res.status(403).json({ 
                message: 'Bạn không có quyền truy cập chi nhánh này.',
                user_branches: userBranchIds,
                requested_branch: parsedBranchId
            });
        }

        let query = `
            SELECT
                p.id, p.name, p.sku, p.barcode, p.image_url, p.base_price, p.unit,
                p.track_stock, p.sold_by_weight, p.active,
                c.name AS category_name,
                COALESCE(ps.stock, 0) AS stock, -- Lấy tồn kho từ product_stocks, nếu không có thì mặc định là 0
                COALESCE(ps.low_stock_threshold, 0) AS low_stock_threshold
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            INNER JOIN product_stocks ps ON p.id = ps.product_id AND ps.branch_id = ?
        `;
        let queryParams = [parsedBranchId]; // Tham số đầu tiên là branch_id cho LEFT JOIN

        let whereClauses = [];

        // Lọc theo tên, SKU hoặc barcode
        if (search) {
            whereClauses.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
            queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        // Lọc theo trạng thái hoạt động
        if (active_only === 'true') {
            whereClauses.push('p.active = 1');
        }
        if (whereClauses.length > 0) {
            query += ` WHERE ` + whereClauses.join(' AND ');
        }

        query += ` ORDER BY p.name ASC`;

        const [rows] = await connection.query(query, queryParams);

        // Xử lý dữ liệu để đảm bảo stock luôn là số và các trường boolean đúng kiểu
        const products = rows.map(product => ({
            ...product,
            base_price: parseFloat(product.base_price) || 0,
            stock: parseFloat(product.stock) || 0,
            low_stock_threshold: parseFloat(product.low_stock_threshold) || 0,
            track_stock: !!product.track_stock,
            sold_by_weight: !!product.sold_by_weight,
            active: !!product.active
        }));

        res.json(products);

    } catch (error) {
        console.error('Lỗi khi lấy danh sách sản phẩm cho POS:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh sách sản phẩm.', error: error.message });
    } finally {
        connection.release();
    }
};

/**
 * [POST] Tạo đơn hàng mới.
 * Xử lý việc lưu đơn hàng, các mặt hàng trong đơn và cập nhật tồn kho.
 *
 * @param {object} req - Đối tượng request, chứa body (branch_id, customer_id, total_amount, paid_amount, payment_method, notes, items) và thông tin người dùng (req.user).
 * @param {object} res - Đối tượng response.
 */
const placeOrder = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const {
            branch_id,
            customer_id,
            total_amount,
            paid_amount,
            payment_method,
            status = 'completed', // Mặc định là 'completed' cho đơn hàng POS
            notes,
            items
        } = req.body;

        const userId = req.user.id;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions && req.user.permissions.includes('admin_global');

        // --- 1. Validation cơ bản ---
        if (!branch_id || !items || items.length === 0 || total_amount === undefined || paid_amount === undefined || !payment_method) {
            await connection.rollback();
            return res.status(400).json({ message: 'Dữ liệu đơn hàng không hợp lệ hoặc thiếu thông tin cần thiết.' });
        }
        if (paid_amount < total_amount) {
            await connection.rollback();
            return res.status(400).json({ message: 'Số tiền khách đưa không đủ để thanh toán.' });
        }

        const parsedBranchId = parseInt(branch_id);
        if (isNaN(parsedBranchId)) {
            await connection.rollback();
            return res.status(400).json({ message: 'ID chi nhánh không hợp lệ.' });
        }

        // Kiểm tra quyền truy cập chi nhánh của người dùng
        if (!isAdmin && !userBranchIds.includes(parsedBranchId)) {
            await connection.rollback();
            return res.status(403).json({ message: 'Bạn không có quyền tạo đơn hàng cho chi nhánh này.' });
        }

        // --- 2. Kiểm tra và cập nhật tồn kho cho từng sản phẩm (nếu track_stock = 1) ---
        const orderItemsForDb = [];
        for (const item of items) {
            const { product_id, quantity, unit_price, modifiers_options_notes, product_name } = item;

            if (!product_id || quantity === undefined || quantity <= 0 || unit_price === undefined) {
                await connection.rollback();
                return res.status(400).json({ message: `Dữ liệu mặt hàng không hợp lệ: ${JSON.stringify(item)}` });
            }

            // Lấy thông tin sản phẩm từ CSDL để kiểm tra track_stock và sold_by_weight
            const [productRows] = await connection.query(
                `SELECT id, name, track_stock, sold_by_weight FROM products WHERE id = ?`,
                [product_id]
            );

            if (productRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: `Sản phẩm với ID ${product_id} không tồn tại.` });
            }
            const dbProduct = productRows[0];

            let finalQuantity = parseFloat(quantity);
            if (dbProduct.sold_by_weight) {
                finalQuantity = parseFloat(finalQuantity.toFixed(2)); // Làm tròn 2 chữ số thập phân nếu bán theo cân nặng
            } else {
                finalQuantity = Math.floor(finalQuantity); // Số nguyên nếu không bán theo cân nặng
            }
            if (finalQuantity <= 0) {
                 await connection.rollback();
                 return res.status(400).json({ message: `Số lượng sản phẩm "${dbProduct.name}" phải lớn hơn 0.` });
            }

            // Tính subtotal dựa trên giá gốc và số lượng đã làm tròn/chuyển đổi
            const subtotal = parseFloat((finalQuantity * unit_price).toFixed(2));

            // Nếu sản phẩm được theo dõi tồn kho, kiểm tra và cập nhật
            if (dbProduct.track_stock) {
                const [stockRows] = await connection.query(
                    `SELECT id, stock FROM product_stocks WHERE product_id = ? AND branch_id = ? FOR UPDATE`, // FOR UPDATE để khóa hàng
                    [product_id, parsedBranchId]
                );

                if (stockRows.length === 0) {
                    await connection.rollback();
                    return res.status(404).json({ message: `Sản phẩm "${dbProduct.name}" không có tồn kho tại chi nhánh này.` });
                }

                const currentStock = stockRows[0].stock;
                if (currentStock < finalQuantity) {
                    await connection.rollback();
                    return res.status(400).json({
                        message: `Không đủ tồn kho cho sản phẩm "${dbProduct.name}". Còn lại: ${currentStock}.`,
                        product_name: dbProduct.name,
                        remaining_stock: currentStock
                    });
                }

                const newStock = currentStock - finalQuantity;
                await connection.query(
                    `UPDATE product_stocks SET stock = ?, updated_at = NOW() WHERE id = ?`,
                    [newStock, stockRows[0].id]
                );

                // Ghi lại giao dịch tồn kho (giảm)
                await connection.query(
                    `INSERT INTO inventory_transactions (product_id, branch_id, quantity, type, current_stock, new_stock, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [product_id, parsedBranchId, finalQuantity, 'sale_out', currentStock, newStock, userId, `Bán hàng đơn #${dbProduct.name}`, new Date()]
                );
            }

            orderItemsForDb.push({
                product_id: product_id,
                product_name_at_time_of_order: dbProduct.name, // Lưu tên sản phẩm tại thời điểm bán
                quantity: finalQuantity,
                unit_price: parseFloat(unit_price),
                subtotal: subtotal,
                modifiers_options_notes: modifiers_options_notes || null
            });
        }

        // --- 3. Tạo đơn hàng chính ---
        const [orderResult] = await connection.query(
            `INSERT INTO orders (branch_id, customer_id, total_amount, paid_amount, change_amount, payment_method, status, notes, user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                parsedBranchId,
                customer_id || null,
                parseFloat(total_amount),
                parseFloat(paid_amount),
                parseFloat(paid_amount) - parseFloat(total_amount), // Tiền thừa
                payment_method,
                status,
                notes || null,
                userId
            ]
        );
        const orderId = orderResult.insertId;

        // --- 4. Thêm các mặt hàng vào đơn hàng ---
        for (const item of orderItemsForDb) {
            await connection.query(
                `INSERT INTO order_items (order_id, product_id, product_name_at_time_of_order, quantity, unit_price, subtotal, modifiers_options_notes, returned_quantity)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    item.product_id,
                    item.product_name_at_time_of_order,
                    item.quantity,
                    item.unit_price,
                    item.subtotal,
                    item.modifiers_options_notes,
                    0 // Giá trị mặc định cho returned_quantity
                ]
            );
        }

        await connection.commit();

        // Lấy thông tin đơn hàng đầy đủ để trả về frontend (bao gồm customer và order_items)
        const [createdOrderRows] = await connection.query(
            `SELECT
                o.*,
                c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.address AS customer_address
             FROM orders o
             LEFT JOIN customers c ON o.customer_id = c.id
             WHERE o.id = ?`,
            [orderId]
        );

        const [orderItemsRows] = await connection.query(
            `SELECT oi.*, p.name AS product_name, p.sku FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`,
            [orderId]
        );

        const createdOrder = createdOrderRows[0];
        if (createdOrder) {
            createdOrder.customer = createdOrder.customer_id ? {
                id: createdOrder.customer_id,
                name: createdOrder.customer_name,
                phone: createdOrder.customer_phone,
                email: createdOrder.customer_email,
                address: createdOrder.customer_address
            } : null;
            createdOrder.order_items = orderItemsRows;
        }

        res.status(201).json({ message: 'Đơn hàng đã được tạo thành công.', order: createdOrder });

    } catch (error) {
        await connection.rollback();
        console.error('Lỗi khi tạo đơn hàng:', {
            message: error.message,
            sql: error.sql, // mysql2 adds this for query errors
            stack: error.stack
        });
        // Trả về lỗi cụ thể hơn nếu có
        if (error.message.includes('Không đủ tồn kho')) { // Bắt lỗi tồn kho tùy chỉnh
             return res.status(400).json({ message: error.message, product_name: error.product_name, remaining_stock: error.remaining_stock });
        }
        res.status(500).json({ message: 'Lỗi server khi tạo đơn hàng.', error: error.message });
    } finally {
        connection.release();
    }
};


module.exports = {
    getSalesProducts,
    placeOrder
};
