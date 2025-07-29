// duongbackend/controllers/statisticsController.js

const { pool } = require('../config/db');

/**
 * Helper function to get accessible branch IDs for a user
 * @param {Object} user - The user object from req.user
 * @returns {Array<number>} An array of branch IDs the user can access
 */
const getAccessibleBranchIds = (user) => {
    const isAdmin = user.permissions.includes('admin_access');
    if (isAdmin) {
        return []; // Admin has access to all, so no specific branch filter needed by default
    }
    return user.branch_ids || [];
};

/**
 * @desc Thống kê tổng quan về đơn hàng
 * @route GET /api/statistics/overall
 * @access Private (yêu cầu quyền 'view_overall_stats_app_thongke')
 */
const getOverallStatistics = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();

        // Lấy danh sách chi nhánh mà người dùng có quyền truy cập
        const accessibleBranchIds = getAccessibleBranchIds(req.user);

        let branchFilterSql = '';
        let branchFilterParams = [];

        if (accessibleBranchIds.length > 0) {
            // Tạo chuỗi placeholder (?,?,...) dựa trên số lượng chi nhánh
            const placeholders = accessibleBranchIds.map(() => '?').join(',');
            branchFilterSql = `AND o.branch_id IN (${placeholders})`;
            branchFilterParams = [...accessibleBranchIds]; // Spread mảng vào params
        } else if (!req.user.permissions.includes('admin_access')) {
            console.log('User does not have access to any branches or is not an admin.');
            return res.json({
                overall: [],
                total_refunded_amount: 0
            });
        }

        const overallQuery = `
            SELECT
                o.status,
                COUNT(o.id) AS total_orders,
                SUM(o.total_amount) AS total_sales,
                SUM(o.paid_amount) AS total_paid,
                SUM(o.change_amount) AS total_change
            FROM orders o
            WHERE 1=1 ${branchFilterSql}
            GROUP BY o.status`;

        console.log('Overall Query SQL:', overallQuery);
        console.log('Overall Query Params:', branchFilterParams);

        const [overallStats] = await connection.execute(overallQuery, branchFilterParams);

        // Sửa đổi branchFilterSql cho bảng returns
        const returnsBranchFilterSql = branchFilterSql.replace(/o\.branch_id/g, 'r.branch_id');
        
        const totalRefundedQuery = `
            SELECT
                SUM(r.total_refund_amount) AS total_refunded_amount
            FROM returns r
            WHERE 1=1 ${returnsBranchFilterSql}`;

        console.log('Total Refunded Query SQL:', totalRefundedQuery);
        console.log('Total Refunded Query Params:', branchFilterParams);

        const [totalRefundedResult] = await connection.execute(totalRefundedQuery, branchFilterParams);

        res.json({
            overall: overallStats,
            total_refunded_amount: totalRefundedResult[0]?.total_refunded_amount || 0
        });

    } catch (error) {
        console.error('Error fetching overall statistics:', error);
        res.status(500).json({
            message: 'Lỗi server khi tải thống kê tổng quan.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * @desc Thống kê theo chi nhánh
 * @route GET /api/statistics/by-branch
 * @access Private (yêu cầu quyền 'view_branch_stats_app_thongke')
 */
const getBranchStatistics = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const accessibleBranchIds = getAccessibleBranchIds(req.user);

        let branchFilterSql = '';
        let branchFilterParams = [];

        if (accessibleBranchIds.length > 0) {
            // Create placeholders for each branch ID
            const placeholders = accessibleBranchIds.map(() => '?').join(',');
            branchFilterSql = `AND o.branch_id IN (${placeholders})`;
            branchFilterParams = [...accessibleBranchIds]; // Spread the array into individual parameters
        } else if (!req.user.permissions.includes('admin_access')) {
            console.log('User does not have access to any branches or is not an admin.');
            return res.json([]);
        }

        const branchStatsQuery = `
            SELECT
                b.id AS branch_id,
                b.name AS branch_name,
                COUNT(o.id) AS total_orders,
                SUM(o.total_amount) AS total_sales,
                SUM(o.paid_amount) AS total_paid,
                SUM(COALESCE(r.total_refund_amount, 0)) AS total_refunded
            FROM orders o
            LEFT JOIN branches b ON o.branch_id = b.id
            LEFT JOIN returns r ON o.id = r.order_id
            WHERE 1=1 ${branchFilterSql}
            GROUP BY b.id, b.name
            ORDER BY total_sales DESC`;

        console.log('Branch Stats Query SQL:', branchStatsQuery);
        console.log('Branch Stats Query Params:', branchFilterParams);

        const [branchStats] = await connection.execute(branchStatsQuery, branchFilterParams);

        res.json(branchStats);

    } catch (error) {
        console.error('Error fetching branch statistics:', error);
        res.status(500).json({
            message: 'Lỗi server khi tải thống kê theo chi nhánh.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * @desc Thống kê sản phẩm bán chạy
 * @route GET /api/statistics/top-selling-products
 * @access Private (yêu cầu quyền 'view_product_stats_app_thongke')
 */
const getTopSellingProducts = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const { limit = 10, start_date, end_date } = req.query;
        const accessibleBranchIds = getAccessibleBranchIds(req.user);

        // Validate inputs
        const parsedLimit = Math.min(parseInt(limit) || 10, 100);
        if (start_date && isNaN(new Date(start_date))) {
            return res.status(400).json({ message: 'Ngày bắt đầu không hợp lệ' });
        }
        if (end_date && isNaN(new Date(end_date))) {
            return res.status(400).json({ message: 'Ngày kết thúc không hợp lệ' });
        }

        let whereClauses = [];
        let queryParams = [];

        // Branch filtering
        if (accessibleBranchIds.length > 0) {
            whereClauses.push(`o.branch_id IN (${accessibleBranchIds.map(() => '?').join(',')})`);
            queryParams.push(...accessibleBranchIds);
        } else if (!req.user.permissions.includes('admin_access')) {
            return res.json([]);
        }

        // Date filtering
        if (start_date) {
            whereClauses.push(`DATE(o.created_at) >= ?`);
            queryParams.push(start_date);
        }
        if (end_date) {
            whereClauses.push(`DATE(o.created_at) <= ?`);
            queryParams.push(end_date);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Build return subquery conditions
        let returnConditions = [];
        let returnParams = [];

        if (start_date) {
            returnConditions.push(`DATE(r.return_date) >= ?`);
            returnParams.push(start_date);
        }
        if (end_date) {
            returnConditions.push(`DATE(r.return_date) <= ?`);
            returnParams.push(end_date);
        }
        if (accessibleBranchIds.length > 0) {
            returnConditions.push(`r.branch_id IN (${accessibleBranchIds.map(() => '?').join(',')})`);
            returnParams.push(...accessibleBranchIds);
        }

        const returnWhereSql = returnConditions.length > 0 ? `AND ${returnConditions.join(' AND ')}` : '';

        // Build the main query
        const query = `
            SELECT
                p.id AS product_id,
                p.name AS product_name,
                p.sku,
                p.image_url,
                p.category_id,
                c.name AS category_name,
                SUM(oi.quantity) AS total_sold_quantity,
                SUM(oi.subtotal) AS total_revenue,
                (
                    SELECT COALESCE(SUM(ri.quantity), 0)
                    FROM return_items ri
                    JOIN returns r ON ri.return_id = r.id
                    WHERE ri.product_id = p.id
                    ${returnWhereSql}
                ) AS total_returned_quantity,
                (SUM(oi.quantity) - (
                    SELECT COALESCE(SUM(ri.quantity), 0)
                    FROM return_items ri
                    JOIN returns r ON ri.return_id = r.id
                    WHERE ri.product_id = p.id
                    ${returnWhereSql}
                )) AS net_sold_quantity
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            ${whereSql}
            GROUP BY p.id, p.name, p.sku, p.image_url, p.category_id, c.name
            ORDER BY net_sold_quantity DESC
            LIMIT ?`;

        // Combine all parameters in correct order
        const allParams = [
            ...queryParams,            // Main query params (for orders and products)
            ...returnParams,           // Subquery params for returns
            ...returnParams,           // Repeated subquery params for returns in the main query
            parsedLimit                // LIMIT value
        ];

        console.log('Executing query:', query);
        console.log('With parameters:', allParams);

        // Execute the query with the parameters
        const [productStats] = await connection.execute(query, allParams);

        res.json(productStats.map(product => ({
            ...product,
            net_sold_quantity: Number(product.net_sold_quantity),
            total_sold_quantity: Number(product.total_sold_quantity),
            total_returned_quantity: Number(product.total_returned_quantity),
            total_revenue: Number(product.total_revenue)
        })));

    } catch (error) {
        console.error('Error fetching top selling products:', {
            message: error.message,
            stack: error.stack,
            sql: error.sql
        });
        res.status(500).json({ 
            message: 'Lỗi server khi tải thống kê sản phẩm bán chạy.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) connection.release();
    }
};


/**
 * @desc Thống kê theo khách hàng
 * @route GET /api/statistics/by-customer
 * @access Private (yêu cầu quyền 'view_customer_stats_app_thongke')
 */
const getCustomerStatistics = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const accessibleBranchIds = getAccessibleBranchIds(req.user);

        // Kiểm tra nếu không có chi nhánh hợp lệ và người dùng không có quyền admin
        if (accessibleBranchIds.length === 0 && !req.user.permissions.includes('admin_access')) {
            return res.status(400).json({
                message: 'Không có chi nhánh hợp lệ hoặc không có quyền truy cập.',
                error: 'No accessible branches or admin access is required'
            });
        }

        let branchFilterSql = '';
        let branchFilterParams = [];

        if (accessibleBranchIds.length > 0) {
            // Tạo các placeholder cho từng branch ID
            branchFilterSql = `AND o.branch_id IN (${accessibleBranchIds.map(() => '?').join(',')})`;
            branchFilterParams = [...accessibleBranchIds];
        }

        // Thực thi truy vấn để lấy thông tin thống kê khách hàng
        const [customerStats] = await connection.execute(
            `SELECT
                c.name AS customer_name,
                c.phone,
                COUNT(o.id) AS total_orders,
                SUM(o.total_amount) AS total_spent,
                SUM(COALESCE(r.total_refund_amount, 0)) AS total_refunded
            FROM orders o
            JOIN customers c ON o.customer_id = c.id
            LEFT JOIN returns r ON o.id = r.order_id
            WHERE o.customer_id IS NOT NULL ${branchFilterSql}
            GROUP BY c.id, c.name, c.phone
            ORDER BY total_spent DESC`,
            branchFilterParams
        );

        // Trả về kết quả nếu có dữ liệu
        if (customerStats.length === 0) {
            return res.status(404).json({
                message: 'Không có dữ liệu thống kê khách hàng.',
                error: 'No customer statistics available'
            });
        }

        // Nếu có dữ liệu, trả về kết quả đã xử lý
        res.json(customerStats.map(customer => ({
            ...customer,
            total_orders: Number(customer.total_orders),
            total_spent: Number(customer.total_spent),
            total_refunded: Number(customer.total_refunded)
        })));

    } catch (error) {
        console.error('Error fetching customer statistics:', {
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            message: 'Lỗi server khi tải thống kê theo khách hàng.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) connection.release();
    }
};


/**
 * @desc Thống kê tồn kho
 * @route GET /api/statistics/stock-overview
 * @access Private (yêu cầu quyền 'view_stock_stats_app_thongke')
 * @param {number} req.query.branch_id - Optional: Filter by specific branch ID
 */
const getStockStatistics = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const { branch_id } = req.query;
        const accessibleBranchIds = getAccessibleBranchIds(req.user);
        const isAdmin = req.user.permissions.includes('admin_access');

        let whereClauses = [];
        let queryParams = [];

        // Nếu có chi nhánh trong yêu cầu, kiểm tra hợp lệ
        if (branch_id) {
            const requestedBranchIdNum = parseInt(branch_id);
            if (isNaN(requestedBranchIdNum)) {
                return res.status(400).json({ message: 'ID chi nhánh không hợp lệ.' });
            }
            if (!isAdmin && !accessibleBranchIds.includes(requestedBranchIdNum)) {
                return res.status(403).json({ message: 'Bạn không có quyền truy cập chi nhánh này.' });
            }
            whereClauses.push(`ps.branch_id = ?`);
            queryParams.push(requestedBranchIdNum);
        } else if (accessibleBranchIds.length > 0) {
            whereClauses.push(`ps.branch_id IN (?)`);
            queryParams.push(accessibleBranchIds);
        } else if (!isAdmin) {
            // Nếu người dùng không phải admin và không có chi nhánh nào được phân quyền
            return res.status(403).json({
                message: 'Bạn không có quyền truy cập vào chi nhánh nào.'
            });
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Truy vấn dữ liệu tồn kho
        const [stockStats] = await connection.execute(
            `SELECT
                p.name AS product_name,
                p.sku,
                b.name AS branch_name,
                ps.stock AS current_stock,
                p.track_stock,
                p.sold_by_weight
            FROM product_stocks ps
            JOIN products p ON ps.product_id = p.id
            JOIN branches b ON ps.branch_id = b.id
            ${whereSql}
            ORDER BY p.name ASC, b.name ASC`,
            queryParams
        );

        // Nếu không có dữ liệu tồn kho
        if (stockStats.length === 0) {
            return res.status(404).json({
                message: 'Không có dữ liệu tồn kho cho chi nhánh hoặc sản phẩm yêu cầu.',
                error: 'No stock data found for the requested branch or products'
            });
        }

        // Trả về kết quả dữ liệu tồn kho
        res.json(stockStats);

    } catch (error) {
        console.error('Error fetching stock statistics:', error);
        res.status(500).json({ 
            message: 'Lỗi server khi tải thống kê tồn kho.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * @desc Thống kê trả hàng
 * @route GET /api/statistics/returns-overview
 * @access Private (yêu cầu quyền 'view_return_stats_app_thongke')
 */
const getReturnStatistics = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const accessibleBranchIds = getAccessibleBranchIds(req.user);

        let branchFilterSql = '';
        let branchFilterParams = [];

        // Kiểm tra quyền truy cập vào các chi nhánh
        if (accessibleBranchIds.length > 0) {
            branchFilterSql = `AND r.branch_id IN (?)`;
            branchFilterParams = [accessibleBranchIds];
        } else if (!req.user.permissions.includes('admin_access')) {
            // Nếu không có chi nhánh truy cập và người dùng không phải admin, trả về mảng rỗng
            return res.status(403).json({ message: 'Bạn không có quyền truy cập vào bất kỳ chi nhánh nào.' });
        }

        const [returnStats] = await connection.execute(
            `SELECT
                ri.product_name_at_return AS product_name,
                SUM(ri.quantity) AS total_returned_quantity,
                SUM(ri.refund_amount) AS total_refunded_amount,
                COALESCE(r.reason, 'Không có lý do') AS return_reason
            FROM return_items ri
            JOIN returns r ON ri.return_id = r.id
            WHERE 1=1 ${branchFilterSql}
            GROUP BY ri.product_name_at_return, r.reason
            ORDER BY total_returned_quantity DESC`,
            branchFilterParams
        );

        // Nếu không có dữ liệu trả hàng, trả về mảng rỗng và thông báo lỗi
        if (returnStats.length === 0) {
            return res.status(404).json({
                message: 'Không có dữ liệu trả hàng cho chi nhánh hoặc sản phẩm yêu cầu.',
                error: 'No return data found for the requested branch or products'
            });
        }

        // Trả về dữ liệu thống kê trả hàng
        res.json(returnStats);

    } catch (error) {
        console.error('Error fetching return statistics:', error);
        res.status(500).json({ 
            message: 'Lỗi server khi tải thống kê trả hàng.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) connection.release();
    }
};


/**
 * @desc Thống kê theo thời gian (Doanh thu hàng ngày/tháng/năm)
 * @route GET /api/statistics/time-based-sales
 * @access Private (yêu cầu quyền 'view_time_stats_app_thongke')
 * @param {string} req.query.period - 'daily', 'monthly', 'yearly'
 * @param {string} req.query.start_date - YYYY-MM-DD
 * @param {string} req.query.end_date - YYYY-MM-DD
 */
const getTimeBasedStatistics = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const { period = 'daily', start_date, end_date } = req.query;
        const accessibleBranchIds = getAccessibleBranchIds(req.user);

        let groupByClause;
        let selectDateClause;

        // Chọn cách nhóm dữ liệu theo thời gian
        switch (period) {
            case 'monthly':
                selectDateClause = `DATE_FORMAT(o.created_at, '%Y-%m') AS period`;
                groupByClause = `DATE_FORMAT(o.created_at, '%Y-%m')`;
                break;
            case 'yearly':
                selectDateClause = `DATE_FORMAT(o.created_at, '%Y') AS period`;
                groupByClause = `DATE_FORMAT(o.created_at, '%Y')`;
                break;
            case 'daily':
            default:
                selectDateClause = `DATE(o.created_at) AS period`;
                groupByClause = `DATE(o.created_at)`;
                break;
        }

        let whereClauses = [];
        let queryParams = [];

        // Kiểm tra quyền truy cập chi nhánh
        if (accessibleBranchIds.length > 0) {
            whereClauses.push(`o.branch_id IN (?)`);
            queryParams.push(accessibleBranchIds);
        } else if (!req.user.permissions.includes('admin_access')) {
            // Nếu không có quyền truy cập và không phải admin, trả về mảng rỗng
            return res.json([]);
        }

        // Lọc theo ngày nếu có
        if (start_date) {
            whereClauses.push(`DATE(o.created_at) >= ?`);
            queryParams.push(start_date);
        }
        if (end_date) {
            whereClauses.push(`DATE(o.created_at) <= ?`);
            queryParams.push(end_date);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Truy vấn thống kê theo thời gian
        const [timeStats] = await connection.execute(
            `SELECT
                ${selectDateClause},
                COUNT(o.id) AS total_orders,
                SUM(o.total_amount) AS total_sales_amount,
                SUM(o.total_refunded_amount) AS total_refunded_amount
            FROM orders o
            ${whereSql}  -- Đã sửa lại ở đây, không cần branchFilterSql nữa
            GROUP BY ${groupByClause}
            ORDER BY period ASC`,
            queryParams
        );

        // Kiểm tra nếu không có dữ liệu, trả về mảng rỗng và thông báo lỗi
        if (timeStats.length === 0) {
            return res.status(404).json({
                message: 'Không có dữ liệu cho khoảng thời gian hoặc chi nhánh yêu cầu.',
                error: 'No data found for the requested time period or branch'
            });
        }

        // Trả về dữ liệu thống kê theo thời gian
        res.json(timeStats);

    } catch (error) {
        console.error('Error fetching time-based statistics:', error);
        res.status(500).json({ 
            message: 'Lỗi server khi tải thống kê theo thời gian.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) connection.release();
    }
};



/**
 * @desc Phân tích sản phẩm bán theo trọng lượng
 * @route GET /api/statistics/weight-based-products
 * @access Private (yêu cầu quyền 'view_weight_stats_app_thongke')
 */
const getWeightBasedProductStatistics = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const accessibleBranchIds = getAccessibleBranchIds(req.user);

        let branchFilterSql = '';
        let branchFilterParams = [];

        // Lọc theo chi nhánh nếu có quyền truy cập
        if (accessibleBranchIds.length > 0) {
            branchFilterSql = `AND o.branch_id IN (?)`;
            branchFilterParams = [accessibleBranchIds];
        } else if (!req.user.permissions.includes('admin_access')) {
            return res.json([]); // Trả về mảng rỗng nếu không có quyền
        }

        // Truy vấn thống kê sản phẩm bán theo trọng lượng
        const [weightStats] = await connection.execute(
            `SELECT
                p.name AS product_name,
                p.sku,
                SUM(oi.quantity) AS total_sold_weight_units, -- Đây là số lượng, đại diện cho trọng lượng
                SUM(oi.subtotal) AS total_revenue_from_weight_products
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN products p ON oi.product_id = p.id
            WHERE p.sold_by_weight = TRUE ${branchFilterSql}
            GROUP BY p.id, p.name, p.sku
            ORDER BY total_sold_weight_units DESC`,
            branchFilterParams
        );

        // Kiểm tra nếu không có dữ liệu
        if (weightStats.length === 0) {
            return res.status(404).json({
                message: 'Không có dữ liệu cho sản phẩm bán theo trọng lượng.',
                error: 'No weight-based product data found'
            });
        }

        // Trả về dữ liệu thống kê
        res.json(weightStats);

    } catch (error) {
        console.error('Error fetching weight-based product statistics:', error);
        res.status(500).json({
            message: 'Lỗi server khi tải thống kê sản phẩm theo trọng lượng.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        if (connection) connection.release();
    }
};



module.exports = {
    getOverallStatistics,
    getBranchStatistics,
    getTopSellingProducts,
    getCustomerStatistics,
    getStockStatistics,
    getReturnStatistics,
    getTimeBasedStatistics,
    getWeightBasedProductStatistics
};
