// duongbackend/controllers/productController.js

const { pool } = require('../config/db');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx'); // Cần cài đặt: npm install xlsx

// Helper function to generate SKU (similar to frontend)
const generateSkuFromName = (name) => {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .replace(/[^\\w\\s-]/g, '')
        .replace(/\\s+/g, '-')
        .replace(/--+/g, '-')
        .trim();
};

// Lấy tất cả sản phẩm
const index = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { search, category_id, branch_id: requestedBranchId, page = 1, per_page = 10 } = req.query;
        const userBranchIds = req.user.branch_ids || [];

        if (!userBranchIds.length) {
            return res.status(403).json({ message: 'Người dùng không có chi nhánh nào được phân quyền.' });
        }

        // Kiểm tra quyền truy cập chi nhánh
        if (
            requestedBranchId &&
            requestedBranchId !== 'all' &&
            !userBranchIds.includes(Number(requestedBranchId))
        ) {
            return res.status(403).json({ message: 'Không có quyền xem sản phẩm của chi nhánh này.' });
        }

        let query = `
            SELECT
                p.id, p.category_id, p.name, p.sku, p.barcode, p.description,
                p.image_url, p.base_price, p.cost_price, p.sold_by_weight,
                p.unit, p.track_stock, p.active, p.created_at, p.updated_at,
                c.name as category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
        `;

        let countQuery = `
            SELECT COUNT(DISTINCT p.id) as total
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
        `;

        const queryParams = [];
        const countQueryParams = [];
        const conditions = [];

        if (search) {
            conditions.push(`(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`);
            const keyword = `%${search}%`;
            queryParams.push(keyword, keyword, keyword);
            countQueryParams.push(keyword, keyword, keyword);
        }

        if (category_id && category_id !== 'all') {
            conditions.push(`p.category_id = ?`);
            queryParams.push(category_id);
            countQueryParams.push(category_id);
        }

        const branchesToUse = (requestedBranchId && requestedBranchId !== 'all')
            ? [Number(requestedBranchId)]
            : userBranchIds;

        if (branchesToUse.length > 0) {
            query += ` LEFT JOIN product_stocks ps ON p.id = ps.product_id`;
            countQuery += ` LEFT JOIN product_stocks ps ON p.id = ps.product_id`;
            const placeholders = branchesToUse.map(() => '?').join(',');
            conditions.push(`ps.branch_id IN (${placeholders})`);
            queryParams.push(...branchesToUse);
            countQueryParams.push(...branchesToUse);
        }

        if (conditions.length > 0) {
            query += ` WHERE ` + conditions.join(' AND ');
            countQuery += ` WHERE ` + conditions.join(' AND ');
        }

        query += ` GROUP BY p.id ORDER BY p.created_at DESC`;

        const offset = (page - 1) * per_page;
        query += ` LIMIT ? OFFSET ?`;
        queryParams.push(parseInt(per_page), offset);

        const [countRows] = await connection.query(countQuery, countQueryParams);
        const total = countRows[0].total;
        const last_page = Math.ceil(total / per_page);

        const [rows] = await connection.query(query, queryParams);
        const productIds = rows.map(row => row.id);

        // ---- Product Stocks ----
        let allProductStocks = [];
        if (productIds.length > 0) {
            [allProductStocks] = await connection.query(
                `SELECT ps.product_id, ps.id as product_stock_id, ps.branch_id, ps.stock, ps.low_stock_threshold,
                        b.name as branch_name
                 FROM product_stocks ps
                 JOIN branches b ON ps.branch_id = b.id
                 WHERE ps.product_id IN (?)`,
                [productIds]
            );
        }

        // ---- Product Options (SỬA CHỖ NÀY) ----
        let [allProductOptions] = await connection.query(
            `SELECT 
                po.product_id, 
                po.id AS product_option_id, 
                po.name AS option_name, 
                po.\`values\` AS option_values
             FROM product_options po
             WHERE po.product_id IN (?)`,
            [productIds]
        );

        // ---- Build response ----
        const products = rows.map(row => {
            const productStocks = allProductStocks
                .filter(ps => ps.product_id === row.id)
                .map(ps => ({
                    id: ps.product_stock_id,
                    branch_id: ps.branch_id,
                    stock: ps.stock,
                    low_stock_threshold: ps.low_stock_threshold,
                    branch: { id: ps.branch_id, name: ps.branch_name }
                }));

                const productOptions = allProductOptions
                .filter(po => po.product_id === row.id)
                .map(po => {
                    return {
                        id: po.product_option_id,
                        name: po.option_name,
                        values: Array.isArray(po.option_values) ? po.option_values : []
                    };
                });

            return {
                id: row.id,
                category_id: row.category_id,
                name: row.name,
                sku: row.sku,
                barcode: row.barcode,
                description: row.description,
                image_url: row.image_url || null,
                base_price: row.base_price,
                cost_price: row.cost_price,
                sold_by_weight: row.sold_by_weight,
                unit: row.unit,
                track_stock: row.track_stock,
                active: row.active,
                created_at: row.created_at,
                updated_at: row.updated_at,
                category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
                product_options: productOptions,
                product_stocks: productStocks,
                modifiers: []
            };
        });

        res.status(200).json({
            data: products,
            current_page: parseInt(page),
            per_page: parseInt(per_page),
            total,
            last_page
        });

    } catch (error) {
        console.error('❌ Error executing product query:', error);
        res.status(500).json({ message: 'Lỗi truy vấn cơ sở dữ liệu khi lấy sản phẩm', error: error.message });
    } finally {
        connection.release();
    }
};


// Lấy chi tiết sản phẩm theo ID
const show = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const userBranchIds = req.user.branch_ids || [];

        if (!userBranchIds.length) {
            return res.status(403).json({ message: 'Bạn không được phân quyền chi nhánh nào.' });
        }

        // Lấy thông tin sản phẩm chính
        const [productRows] = await connection.query(
            `SELECT
                p.*,
                c.name as category_name
            FROM
                products p
            LEFT JOIN
                categories c ON p.category_id = c.id
            WHERE p.id = ?`,
            [id]
        );

        if (productRows.length === 0) {
            return res.status(404).json({ message: 'Sản phẩm không tìm thấy' });
        }

        const product = {
            id: productRows[0].id,
            category_id: productRows[0].category_id,
            name: productRows[0].name,
            sku: productRows[0].sku,
            barcode: productRows[0].barcode,
            description: productRows[0].description,
            image_url: productRows[0].image_url ? `/uploads/${productRows[0].image_url}` : null,
            base_price: productRows[0].base_price,
            cost_price: productRows[0].cost_price,
            sold_by_weight: productRows[0].sold_by_weight,
            unit: productRows[0].unit,
            track_stock: productRows[0].track_stock,
            active: productRows[0].active,
            created_at: productRows[0].created_at,
            updated_at: productRows[0].updated_at,
            category: productRows[0].category_id
                ? { id: productRows[0].category_id, name: productRows[0].category_name }
                : null,
            product_options: [],
            product_stocks: [],
            modifiers: []
        };

        // 🔐 Lấy tồn kho chỉ trong các chi nhánh được phân quyền
        const [stockRows] = await connection.query(
            `SELECT ps.id, ps.branch_id, ps.stock, ps.low_stock_threshold,
                    ps.available, ps.price_override,
                    b.name as branch_name
             FROM product_stocks ps
             JOIN branches b ON ps.branch_id = b.id
             WHERE ps.product_id = ?
             AND ps.branch_id IN (${userBranchIds.map(() => '?').join(',')})`,
            [id, ...userBranchIds]
        );

        product.product_stocks = stockRows.map(row => ({
            id: row.id,
            branch_id: row.branch_id,
            stock: row.stock,
            low_stock_threshold: row.low_stock_threshold,
            available: row.available,
            price_override: row.price_override,
            branch: {
                id: row.branch_id,
                name: row.branch_name
            }
        }));

        // ✅ Tùy chọn sản phẩm
        const [optionRows] = await connection.query(
            `SELECT po.id, po.name, po.values
             FROM product_options po
             WHERE po.product_id = ?`,
            [id]
        );

        product.product_options = optionRows.map(row => {
            let optionValues = [];
            try {
                optionValues = typeof row.values === 'string' ? JSON.parse(row.values) : [];
            } catch (e) {
                console.error('Lỗi parse option_values sản phẩm:', id, e.message);
            }
            return {
                id: row.id,
                name: row.name,
                values: optionValues
            };
        });

        res.status(200).json(product);

    } catch (error) {
        console.error('Error in show function:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy chi tiết sản phẩm', error: error.message });
    } finally {
        connection.release();
    }
};


// Tạo sản phẩm mới
const store = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const {
            category_id, name, sku, barcode, description, base_price,
            cost_price, sold_by_weight, unit, track_stock, active,
            options, stocks
        } = req.body;

        const image_filename = req.file ? req.file.filename : null;
        const image_url_from_body = req.body.image_url;
        const final_image_path = image_filename || image_url_from_body || null;

        const userBranchIds = req.user.branch_ids || [];

        // Validate bắt buộc
        if (!name || !sku || base_price === undefined || !unit || !category_id) {
            await connection.rollback();
            return res.status(400).json({
                message: 'Vui lòng điền đầy đủ các trường bắt buộc: Tên, SKU, Giá gốc, Đơn vị, Danh mục.'
            });
        }

        // Kiểm tra trùng SKU hoặc Barcode
        const [existingProduct] = await connection.query(
            `SELECT id FROM products WHERE sku = ? OR (barcode IS NOT NULL AND barcode = ?)`,
            [sku, barcode]
        );
        if (existingProduct.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'SKU hoặc Mã vạch đã tồn tại.' });
        }

        // Thêm sản phẩm
        const [result] = await connection.query(
            `INSERT INTO products (
                category_id, name, sku, barcode, description, image_url,
                base_price, cost_price, sold_by_weight, unit, track_stock, active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                category_id, name, sku, barcode, description, final_image_path,
                base_price, cost_price, sold_by_weight, unit, track_stock, active
            ]
        );

        const productId = result.insertId;

        // Thêm options nếu có
        if (options) {
            let parsedOptions = [];
            try {
                parsedOptions = JSON.parse(options);
                if (!Array.isArray(parsedOptions)) parsedOptions = [];
            } catch {
                parsedOptions = [];
            }

            for (const opt of parsedOptions) {
                await connection.query(
                    `INSERT INTO product_options (product_id, name, \`values\`) VALUES (?, ?, ?)`,
                    [productId, opt.name, JSON.stringify(opt.values || [])]
                );
            }
        }

        // Thêm tồn kho nếu bật theo dõi
        if (track_stock && stocks) {
            let parsedStocks = [];
            try {
                parsedStocks = JSON.parse(stocks);
                if (!Array.isArray(parsedStocks)) parsedStocks = [];
            } catch {
                await connection.rollback();
                return res.status(400).json({ message: 'Dữ liệu tồn kho không hợp lệ.' });
            }

            for (const stock of parsedStocks) {
                if (!stock || typeof stock.branch_id !== 'number') {
                    await connection.rollback();
                    return res.status(400).json({ message: 'Mỗi tồn kho phải có branch_id hợp lệ.' });
                }

                if (!userBranchIds.includes(stock.branch_id)) {
                    await connection.rollback();
                    return res.status(403).json({
                        message: `Không có quyền tạo tồn kho cho chi nhánh ID ${stock.branch_id}.`
                    });
                }

                await connection.query(
                    `INSERT INTO product_stocks (product_id, branch_id, stock, low_stock_threshold)
                     VALUES (?, ?, ?, ?)`,
                    [productId, stock.branch_id, stock.stock || 0, stock.low_stock_threshold || 0]
                );
            }
        }

        await connection.commit();
        res.status(201).json({
            message: 'Sản phẩm đã được thêm thành công',
            productId
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error adding product:', error);
        res.status(500).json({
            message: 'Lỗi server khi thêm sản phẩm',
            error: error.message
        });
    } finally {
        connection.release();
    }
};

//cap nhat
const update = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const {
            category_id, name, sku, barcode, description, base_price,
            cost_price, sold_by_weight, unit, track_stock, active,
            options, stocks
        } = req.body;

        const userBranchIds = req.user.branch_ids || [];

        // Kiểm tra quyền trên tồn kho hiện tại
        const [productStocks] = await connection.query(
            `SELECT DISTINCT branch_id FROM product_stocks WHERE product_id = ?`,
            [id]
        );
        const unauthorizedBranch = productStocks.find(p => !userBranchIds.includes(p.branch_id));
        if (unauthorizedBranch) {
            await connection.rollback();
            return res.status(403).json({ message: `Không có quyền chỉnh sửa sản phẩm tại chi nhánh ID ${unauthorizedBranch.branch_id}` });
        }

        // Xử lý ảnh (ảnh upload mới hoặc từ URL)
        const image_filename = req.file ? req.file.filename : null;
        const image_url_from_body = req.body.image_url;
        let final_image_path = null;

        if (image_filename) {
            final_image_path = image_filename;
        } else if (image_url_from_body !== undefined) {
            final_image_path = image_url_from_body === '' ? null : image_url_from_body;
        } else {
            const [currentProduct] = await connection.query('SELECT image_url FROM products WHERE id = ?', [id]);
            final_image_path = currentProduct.length > 0 ? currentProduct[0].image_url : null;
        }

        // TODO: Nếu bạn có upload file Excel thì xử lý ở đây:
        // VD: file Excel upload: req.fileExcel
        // Nếu cần bạn có thể lấy tên file hoặc đường dẫn từ req.fileExcel.filename

        // Validate bắt buộc
        if (!name || !sku || base_price === undefined || !unit || !category_id) {
            await connection.rollback();
            return res.status(400).json({ message: 'Vui lòng điền đầy đủ các trường bắt buộc.' });
        }

        // Kiểm tra trùng SKU/barcode
        const [existingProduct] = await connection.query(
            `SELECT id FROM products WHERE (sku = ? OR (barcode IS NOT NULL AND barcode = ?)) AND id != ?`,
            [sku, barcode, id]
        );
        if (existingProduct.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'SKU hoặc Mã vạch đã tồn tại cho sản phẩm khác.' });
        }

        // Cập nhật sản phẩm
        await connection.query(
            `UPDATE products SET category_id = ?, name = ?, sku = ?, barcode = ?, description = ?, image_url = ?,
                                base_price = ?, cost_price = ?, sold_by_weight = ?, unit = ?, track_stock = ?, active = ?
             WHERE id = ?`,
            [category_id, name, sku, barcode, description, final_image_path,
            base_price, cost_price, sold_by_weight, unit, track_stock, active, id]
        );

        // Cập nhật options
        await connection.query(`DELETE FROM product_options WHERE product_id = ?`, [id]);
        if (options) {
            let parsedOptions = [];
            try {
                parsedOptions = JSON.parse(options);
                if (!Array.isArray(parsedOptions)) parsedOptions = [];
            } catch {
                parsedOptions = [];
            }

            for (const opt of parsedOptions) {
                await connection.query(
                    `INSERT INTO product_options (product_id, name, \`values\`) VALUES (?, ?, ?)`,
                    [id, opt.name, JSON.stringify(opt.values || [])]
                );
            }
        }

        // Cập nhật tồn kho: xóa các tồn kho của các chi nhánh user có quyền rồi thêm lại
        await connection.query(
            `DELETE FROM product_stocks WHERE product_id = ? AND branch_id IN (?)`,
            [id, userBranchIds]
        );

        if (track_stock && stocks) {
            let parsedStocks = [];
            try {
                parsedStocks = JSON.parse(stocks);
                if (!Array.isArray(parsedStocks)) parsedStocks = [];
            } catch {
                await connection.rollback();
                return res.status(400).json({ message: 'Dữ liệu tồn kho không hợp lệ.' });
            }

            for (const stock of parsedStocks) {
                if (!stock || typeof stock.branch_id !== 'number') {
                    await connection.rollback();
                    return res.status(400).json({ message: 'Mỗi tồn kho phải có branch_id hợp lệ.' });
                }

                if (!userBranchIds.includes(stock.branch_id)) {
                    await connection.rollback();
                    return res.status(403).json({
                        message: `Không có quyền cập nhật tồn kho cho chi nhánh ID ${stock.branch_id}.`
                    });
                }

                await connection.query(
                    `INSERT INTO product_stocks (product_id, branch_id, stock, low_stock_threshold)
                     VALUES (?, ?, ?, ?)`,
                    [id, stock.branch_id, stock.stock || 0, stock.low_stock_threshold || 0]
                );
            }
        }

        await connection.commit();
        res.status(200).json({ message: 'Sản phẩm đã được cập nhật thành công' });

    } catch (error) {
        await connection.rollback();
        console.error('Error updating product:', error);
        res.status(500).json({ message: 'Lỗi server khi cập nhật sản phẩm', error: error.message });
    } finally {
        connection.release();
    }
};



// Xóa sản phẩm
const destroy = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const userBranchIds = req.user.branch_ids || [];

        // ✅ Kiểm tra chi nhánh sản phẩm
        const [productStocks] = await connection.query(
            `SELECT DISTINCT branch_id FROM product_stocks WHERE product_id = ?`,
            [id]
        );

        const unauthorizedBranch = productStocks.find(p => !userBranchIds.includes(p.branch_id));
        if (unauthorizedBranch) {
            await connection.rollback();
            return res.status(403).json({
                message: `Bạn không có quyền xóa sản phẩm thuộc chi nhánh (branch_id=${unauthorizedBranch.branch_id}).`
            });
        }

        // ✅ Lấy ảnh sản phẩm để xóa
        const [productRows] = await connection.query(
            'SELECT image_url FROM products WHERE id = ?',
            [id]
        );
        let imageUrlToDelete = null;
        if (
            productRows.length > 0 &&
            productRows[0].image_url &&
            !productRows[0].image_url.startsWith('http')
        ) {
            imageUrlToDelete = productRows[0].image_url;
        }

        // ✅ Xóa dữ liệu liên quan
        await connection.query(`DELETE FROM product_options WHERE product_id = ?`, [id]);
        await connection.query(`DELETE FROM product_stocks WHERE product_id = ?`, [id]);
        // Nếu có bảng modifiers hoặc các bảng liên quan khác, thêm dòng DELETE tại đây.

        // ✅ Xóa sản phẩm chính
        const [result] = await connection.query(`DELETE FROM products WHERE id = ?`, [id]);
        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Sản phẩm không tìm thấy' });
        }

        // ✅ Xóa file ảnh nếu tồn tại
        if (imageUrlToDelete) {
            const imagePath = path.join(__dirname, '../uploads', imageUrlToDelete);
            fs.unlink(imagePath, (err) => {
                if (err) {
                    console.error('Không thể xóa file ảnh:', imagePath, err);
                } else {
                    console.log('Đã xóa file ảnh:', imagePath);
                }
            });
        }

        await connection.commit();
        res.status(200).json({ message: 'Sản phẩm đã được xóa thành công' });

    } catch (error) {
        await connection.rollback();
        console.error('Error deleting product:', error);
        res.status(500).json({ message: 'Lỗi server khi xóa sản phẩm', error: error.message });
    } finally {
        connection.release();
    }
};

const getCategoriesList = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    const userBranchIds = req.user.branch_ids || [];
    const userPermissions = req.user.permissions || [];

    // Giả sử có quyền 'admin' hoặc vai trò 'Admin' nào đó
    const isAdmin = userPermissions.includes('admin');

    let query = `
      SELECT DISTINCT c.id, c.name, c.parent_id, c.position
      FROM categories c
      LEFT JOIN category_branches cb ON c.id = cb.category_id
    `;

    let params = [];

    if (!isAdmin) {
      if (userBranchIds.length === 0) {
        // User không có chi nhánh -> không có danh mục
        return res.status(200).json([]);
      }
      // Lọc danh mục theo chi nhánh user
      query += ` WHERE cb.branch_id IN (${userBranchIds.map(() => '?').join(',')})`;
      params = userBranchIds;
    }

    query += ` ORDER BY c.position ASC, c.name ASC`;

    const [rows] = await connection.query(query, params);

    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching categories list:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy danh sách danh mục', error: error.message });
  } finally {
    if (connection) connection.release();
  }
};

  const getBranchesList = async (req, res) => {
    let connection;
    try {
      connection = await pool.getConnection();
  
      // Giả sử req.user.branch_ids là mảng chứa các branch_id user được quyền quản lý
      const userBranchIds = req.user.branch_ids || [];
  
      if (userBranchIds.length === 0) {
        // Nếu user không có chi nhánh nào, trả về mảng rỗng luôn
        return res.status(200).json([]);
      }
  
      const [rows] = await connection.query(
        'SELECT id, name FROM branches WHERE id IN (?) ORDER BY name ASC',
        [userBranchIds]
      );
  
      res.status(200).json(rows);
    } catch (error) {
      console.error('Error fetching branches list:', error);
      res.status(500).json({ message: 'Lỗi server khi lấy danh sách chi nhánh', error: error.message });
    } finally {
      if (connection) connection.release();
    }
  };
  
  
  const exportProducts = async (req, res) => {
    console.log('ExportProducts controller called');
    try {
        const connection = await pool.getConnection();

        // Giả sử userBranchIds là mảng id chi nhánh user được phép
        const userBranchIds = req.user.branch_ids || []; // VD: [1,3,5]

        // Lấy sản phẩm (không cần lọc chi nhánh ở đây vì sản phẩm thuộc nhiều chi nhánh)
        const [products] = await connection.query(`
            SELECT
                p.id, p.name, p.sku, p.barcode, p.description, p.image_url,
                p.base_price, p.cost_price, p.sold_by_weight, p.unit, p.track_stock, p.active,
                c.name as category_name
            FROM
                products p
            LEFT JOIN
                categories c ON p.category_id = c.id
            ORDER BY p.name ASC
        `);

        // Lấy tồn kho nhưng chỉ những chi nhánh user có quyền
        const [productStocks] = await connection.query(`
            SELECT
                ps.product_id, ps.branch_id, ps.stock, ps.low_stock_threshold,
                b.name as branch_name
            FROM
                product_stocks ps
            JOIN
                branches b ON ps.branch_id = b.id
            WHERE
                ps.branch_id IN (?)
        `, [userBranchIds]);

        const [productOptions] = await connection.query(`
            SELECT
                po.product_id, po.name as option_name, \`values\` as option_values
            FROM
                product_options po
        `);

        connection.release();

        const productsWithDetails = products.map(p => {
            const stocks = productStocks.filter(ps => ps.product_id === p.id);
            const options = productOptions.filter(po => po.product_id === p.id);

            // Chuyển đổi sold_by_weight và active sang dạng dễ đọc
            const soldBy = p.sold_by_weight ? 'Trọng lượng/Khối lượng' : 'Mỗi';
            const status = p.active ? 'Kích hoạt' : 'Vô hiệu';

            // Định dạng tồn kho theo chi nhánh (chỉ chi nhánh user có quyền)
            const stockDetails = stocks.map(s => `${s.branch_name}: ${s.stock} (Ngưỡng: ${s.low_stock_threshold})`).join('; ');

            // Định dạng tùy chọn (cần parse JSON nếu chưa)
            const optionDetails = options.map(o => {
                let values = [];
                try {
                    values = typeof o.option_values === 'string' ? JSON.parse(o.option_values) : o.option_values;
                } catch {
                    values = [];
                }
                return `${o.option_name}: ${values.join(', ')}`;
            }).join('; ');

            return {
                'ID': p.id,
                'Tên sản phẩm': p.name,
                'SKU': p.sku,
                'Mã vạch': p.barcode,
                'Mô tả': p.description,
                'URL Ảnh': p.image_url ? `/uploads/${p.image_url}` : '',
                'Giá gốc': p.base_price,
                'Giá vốn': p.cost_price,
                'Bán bởi': soldBy,
                'Đơn vị': p.unit,
                'Theo dõi tồn kho': p.track_stock ? 'Có' : 'Không',
                'Trạng thái': status,
                'Danh mục': p.category_name,
                'Tồn kho chi tiết': stockDetails,
                'Tùy chọn sản phẩm': optionDetails
            };
        });

        const worksheet = xlsx.utils.json_to_sheet(productsWithDetails);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Sản phẩm');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        console.error('Error exporting products:', error);
        res.status(500).json({ message: 'Lỗi server khi xuất sản phẩm ra Excel', error: error.message });
    }
};

// Import Products from Excel
const importProducts = async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Không có file nào được tải lên.' });
        }

        const filePath = req.file.path;
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const productsData = xlsx.utils.sheet_to_json(worksheet);

        const overwriteExisting = req.body.overwrite_existing === '1'; // Chuyển đổi về boolean

        const userBranchIds = req.user.branch_ids || []; // Mảng chứa các branch_id user có quyền

        let importedCount = 0;
        let updatedCount = 0;
        const validationErrors = [];
        const conflicts = []; // Để lưu các sản phẩm trùng nhưng không update

        for (let i = 0; i < productsData.length; i++) {
            const rowData = productsData[i];
            const rowNum = i + 2; // Dòng Excel (bắt đầu từ 2 vì hàng tiêu đề)

            try {
                // Basic validation for required fields
                if (!rowData['Tên sản phẩm'] || !rowData['SKU'] || rowData['Giá gốc'] === undefined || rowData['Giá gốc'] === null || !rowData['Đơn vị'] || !rowData['Danh mục']) {
                    validationErrors.push({ row: rowNum, errors: ['Thiếu các trường bắt buộc (Tên sản phẩm, SKU, Giá gốc, Đơn vị, Danh mục).'] });
                    continue;
                }

                const name = rowData['Tên sản phẩm'];
                const sku = String(rowData['SKU']);
                const barcode = rowData['Mã vạch'] ? String(rowData['Mã vạch']) : null;
                const description = rowData['Mô tả'] || null;
                const image_url = rowData['URL Ảnh'] || null;
                const base_price = parseFloat(rowData['Giá gốc']);
                const cost_price = rowData['Giá vốn'] ? parseFloat(rowData['Giá vốn']) : null;
                const sold_by_weight = rowData['Bán bởi'] === 'Trọng lượng/Khối lượng';
                const unit = rowData['Đơn vị'];
                const track_stock = rowData['Theo dõi tồn kho'] === 'Có';
                const active = rowData['Trạng thái'] === 'Kích hoạt';
                const categoryName = rowData['Danh mục'];

                if (isNaN(base_price) || (cost_price !== null && isNaN(cost_price))) {
                    validationErrors.push({ row: rowNum, errors: ['Giá gốc hoặc Giá vốn không hợp lệ.'] });
                    continue;
                }

                // Tìm category_id
                const [categoryRows] = await connection.query('SELECT id FROM categories WHERE name = ?', [categoryName]);
                if (categoryRows.length === 0) {
                    validationErrors.push({ row: rowNum, errors: [`Danh mục '${categoryName}' không tồn tại.`] });
                    continue;
                }
                const category_id = categoryRows[0].id;

                // Xử lý tùy chọn sản phẩm
                let optionsArray = [];
                if (rowData['Tùy chọn sản phẩm']) {
                    const optionString = String(rowData['Tùy chọn sản phẩm']);
                    const optionPairs = optionString.split(';').map(s => s.trim()).filter(s => s);
                    for (const pair of optionPairs) {
                        const parts = pair.split(':').map(s => s.trim());
                        if (parts.length === 2) {
                            const optName = parts[0];
                            let optValues = [];
                            const rawValue = parts[1];
                            try {
                                if (rawValue.trim().startsWith('[')) {
                                    optValues = JSON.parse(rawValue);
                                } else {
                                    optValues = rawValue.split(',').map(v => v.trim()).filter(v => v);
                                }
                            } catch (e) {
                                validationErrors.push({ row: rowNum, errors: [`Giá trị tùy chọn sản phẩm không hợp lệ: ${rawValue}`] });
                            }
                            optionsArray.push({ name: optName, values: optValues });
                        }
                    }
                }

                // Xử lý tồn kho chi tiết
                let stocksArray = [];
                if (rowData['Tồn kho chi tiết']) {
                    const stockString = String(rowData['Tồn kho chi tiết']);
                    const stockEntries = stockString.split(';').map(s => s.trim()).filter(s => s);
                    for (const entry of stockEntries) {
                        const match = entry.match(/(.*?):\s*(\d+)\s*\(Ngưỡng:\s*(\d+)\)/);
                        if (match) {
                            const branchName = match[1].trim();
                            const stockValue = parseInt(match[2]);
                            const lowStockThreshold = parseInt(match[3]);

                            const [branchRows] = await connection.query('SELECT id FROM branches WHERE name = ?', [branchName]);
                            if (branchRows.length > 0) {
                                const branchId = branchRows[0].id;
                                if (userBranchIds.length > 0 && !userBranchIds.includes(branchId)) {
                                    validationErrors.push({ row: rowNum, errors: [`Chi nhánh '${branchName}' không thuộc quyền của bạn.`] });
                                } else {
                                    stocksArray.push({
                                        branch_id: branchId,
                                        stock: stockValue,
                                        low_stock_threshold: lowStockThreshold
                                    });
                                }
                            } else {
                                validationErrors.push({ row: rowNum, errors: [`Chi nhánh '${branchName}' không tồn tại.`] });
                            }
                        }
                    }
                }

                // Nếu user có theo dõi tồn kho mà không có chi nhánh hợp lệ thì báo lỗi
                if (track_stock && stocksArray.length === 0 && userBranchIds.length > 0) {
                    validationErrors.push({ row: rowNum, errors: ['Không có chi nhánh tồn kho hợp lệ trong quyền của bạn.'] });
                    continue;
                }

                // Kiểm tra sản phẩm tồn tại
                const [existingProducts] = await connection.query(
                    `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.sku = ? OR (p.barcode IS NOT NULL AND p.barcode = ?)`,
                    [sku, barcode]
                );

                let existingProduct = null;
                if (existingProducts.length > 0) {
                    existingProduct = existingProducts[0];

                    const [existingStocks] = await connection.query('SELECT branch_id, stock, low_stock_threshold FROM product_stocks WHERE product_id = ?', [existingProduct.id]);
                    const [existingOptions] = await connection.query('SELECT name, `values` FROM product_options WHERE product_id = ?', [existingProduct.id]);
                    existingProduct.stocks = existingStocks;
                    existingProduct.options = existingOptions.map(opt => {
                        let values = [];
                        try {
                            if (typeof opt.values === 'string' && opt.values.trim().startsWith('[')) {
                                values = JSON.parse(opt.values);
                            } else {
                                values = opt.values.split(',').map(v => v.trim());
                            }
                        } catch (e) {
                            console.error('Lỗi khi xử lý product_options.values:', e.message);
                            values = [];
                        }
                        return {
                            name: opt.name,
                            values
                        };
                    });
                }

                if (existingProduct) {
                    if (overwriteExisting) {
                        // Cập nhật sản phẩm
                        await connection.query(
                            `UPDATE products SET category_id = ?, name = ?, barcode = ?, description = ?, image_url = ?,
                             base_price = ?, cost_price = ?, sold_by_weight = ?, unit = ?, track_stock = ?, active = ?
                             WHERE id = ?`,
                            [category_id, name, barcode, description, image_url,
                             base_price, cost_price, sold_by_weight, unit, track_stock, active, existingProduct.id]
                        );

                        // Cập nhật options
                        await connection.query(`DELETE FROM product_options WHERE product_id = ?`, [existingProduct.id]);
                        for (const opt of optionsArray) {
                            await connection.query(
                                `INSERT INTO product_options (product_id, name, \`values\`) VALUES (?, ?, ?)`,
                                [existingProduct.id, opt.name, JSON.stringify(opt.values)]
                            );
                        }

                        // Cập nhật stocks
                        await connection.query(`DELETE FROM product_stocks WHERE product_id = ?`, [existingProduct.id]);
                        if (track_stock) {
                            for (const stock of stocksArray) {
                                await connection.query(
                                    `INSERT INTO product_stocks (product_id, branch_id, stock, low_stock_threshold) VALUES (?, ?, ?, ?)`,
                                    [existingProduct.id, stock.branch_id, stock.stock, stock.low_stock_threshold]
                                );
                            }
                        }
                        updatedCount++;
                    } else {
                        // Thêm vào danh sách conflict
                        conflicts.push({
                            row: rowNum,
                            existing: {
                                name: existingProduct.name,
                                base_price: existingProduct.base_price,
                                track_stock: existingProduct.track_stock,
                                active: existingProduct.active,
                                stocks: existingProduct.stocks,
                                options: existingProduct.options,
                            },
                            proposed: {
                                name: name,
                                sku: sku,
                                barcode: barcode,
                                base_price: base_price,
                                track_stock: track_stock,
                                active: active,
                                stocks: stocksArray,
                                options: optionsArray,
                            }
                        });
                    }
                } else {
                    // Thêm sản phẩm mới
                    const [result] = await connection.query(
                        `INSERT INTO products (category_id, name, sku, barcode, description, image_url,
                             base_price, cost_price, sold_by_weight, unit, track_stock, active)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [category_id, name, sku, barcode, description, image_url,
                         base_price, cost_price, sold_by_weight, unit, track_stock, active]
                    );
                    const newProductId = result.insertId;

                    // Thêm options
                    for (const opt of optionsArray) {
                        await connection.query(
                            `INSERT INTO product_options (product_id, name, \`values\`) VALUES (?, ?, ?)`,
                            [newProductId, opt.name, JSON.stringify(opt.values)]
                        );
                    }

                    // Thêm stocks
                    if (track_stock) {
                        for (const stock of stocksArray) {
                            await connection.query(
                                `INSERT INTO product_stocks (product_id, branch_id, stock, low_stock_threshold) VALUES (?, ?, ?, ?)`,
                                [newProductId, stock.branch_id, stock.stock, stock.low_stock_threshold]
                            );
                        }
                    }
                    importedCount++;
                }

            } catch (dbError) {
                console.error(`Database error processing row ${rowNum}:`, dbError);
                if (dbError.code === 'ER_DUP_ENTRY') {
                    validationErrors.push({ row: rowNum, errors: [`Dữ liệu đã tồn tại (có thể do trùng lặp SKU/Mã vạch).`] });
                } else {
                    validationErrors.push({ row: rowNum, errors: [`Lỗi xử lý dữ liệu: ${dbError.message}`] });
                }
            }
        }

        // Nếu có lỗi validation, rollback và trả về
        if (validationErrors.length > 0) {
            await connection.rollback();
            fs.unlinkSync(filePath); // Xóa file tạm
            return res.status(400).json({
                message: 'Có lỗi trong dữ liệu nhập.',
                validationErrors,
                conflicts
            });
        }

        await connection.commit();
        fs.unlinkSync(filePath); // Xóa file tạm

        res.json({
            message: 'Import sản phẩm hoàn tất.',
            imported: importedCount,
            updated: updatedCount,
            conflicts,
            validationErrors
        });
    } catch (error) {
        await connection.rollback();
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        console.error('Lỗi hệ thống:', error);
        res.status(500).json({ message: 'Lỗi hệ thống, vui lòng thử lại sau.' });
    } finally {
        connection.release();
    }
};

const getByBranch = async (req, res) => {
    try {
        // Gán branch_id từ params vào query để tái sử dụng logic trong index GET /products/branch/3?page=1&per_page=20 → Nó sẽ tái sử dụng toàn bộ logic của index với chi nhánh là 3.
        req.query.branch_id = req.params.branch_id;
        return index(req, res);
    } catch (error) {
        console.error('Lỗi trong getByBranch:', error);
        return res.status(500).json({ message: 'Lỗi server khi lấy sản phẩm theo chi nhánh' });
    }
};

module.exports = {
    index,
    show,
    store,
    update,
    destroy,
    getCategoriesList,
    getBranchesList,
    exportProducts,
    importProducts,
    getByBranch
};
