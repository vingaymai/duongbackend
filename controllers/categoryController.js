// duongbackend/controllers/categoryController.js

const { pool } = require('../config/db');
const xlsx = require('xlsx'); // Cần cài đặt: npm install xlsx

// Helper function to build category hierarchy (for internal use or specific API needs)
const buildCategoryHierarchy = (categories, parentId = null, level = 0) => {
    let hierarchicalList = [];
    const children = categories.filter(cat => cat.parent_id === parentId);
    children.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    for (const category of children) {
        hierarchicalList.push({ ...category, level: level });

        hierarchicalList = hierarchicalList.concat(
            buildCategoryHierarchy(categories, category.id, level + 1)
        );
    }
    return hierarchicalList;
};

// Get all categories (for frontend to filter/paginate locally)
// Get all categories (for frontend to filter/paginate locally)
const index = async (req, res) => {
    console.log("➡️ User permissions:", req.user.permissions);
console.log("➡️ User branch_ids:", req.user.branch_ids);
    const connection = await pool.getConnection();
    try {
        console.log('User branch IDs:', req.user.branch_ids);
        const { include_branches } = req.query;
        const userBranchIds = req.user.branch_ids || [];
        const isAdmin = req.user.permissions && req.user.permissions.includes('admin_global');

        let query = `
            SELECT 
                c.id, c.name, c.slug, c.parent_id, c.position, c.active,
                c.created_at, c.updated_at,
                pc.name AS parent_name
            FROM categories c
            LEFT JOIN categories pc ON c.parent_id = pc.id
        `;

        let params = [];

        if (!isAdmin && userBranchIds.length > 0) {
            query += `
                WHERE EXISTS (
                    SELECT 1 FROM category_branches cb 
                    WHERE cb.category_id = c.id AND cb.branch_id IN (${userBranchIds.map(() => '?').join(',')})
                )
            `;
            params = userBranchIds;
        } else if (!isAdmin && userBranchIds.length === 0) {
            connection.release();
            return res.json([]);
        }
        // Nếu isAdmin thì không lọc gì thêm, lấy tất cả categories

        query += ` ORDER BY c.position ASC, c.name ASC`;

        const [rows] = await connection.execute(query, params);

        // Nếu cần lấy luôn branches (include_branches = true)
        if (include_branches === 'true') {
            // Lấy branch info cho từng category
            const categoryIds = rows.map(c => c.id);
            if (categoryIds.length > 0) {
                const [branches] = await connection.query(
                    `SELECT category_id, branch_id FROM category_branches WHERE category_id IN (${categoryIds.map(() => '?').join(',')})`,
                    categoryIds
                );

                // Map branches theo category_id
                const branchesByCategory = {};
                branches.forEach(b => {
                    if (!branchesByCategory[b.category_id]) {
                        branchesByCategory[b.category_id] = [];
                    }
                    branchesByCategory[b.category_id].push(b.branch_id);
                });

                // Gắn thông tin branch vào từng category
                rows.forEach(cat => {
                    cat.branch_ids = branchesByCategory[cat.id] || [];
                });
            }
        }

        const hierarchicalRows = buildCategoryHierarchy(rows);
        res.json(hierarchicalRows);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh mục' });
    } finally {
        connection.release();
    }
};

// Create a new category
const createCategory = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { name, slug, parent_id, position, active, branch_ids } = req.body;

        if (!name || !slug || !Array.isArray(branch_ids) || branch_ids.length === 0) {
            return res.status(400).json({ message: 'Tên danh mục, slug và ít nhất một chi nhánh là bắt buộc.' });
        }

        // Validate branch_ids against user's allowed branches
        const userBranchIds = req.user.branch_ids || [];
        const invalidBranchIds = branch_ids.filter(id => !userBranchIds.includes(id));
        if (invalidBranchIds.length > 0) {
            await connection.rollback();
            return res.status(403).json({ message: `Bạn không có quyền truy cập các chi nhánh với ID: ${invalidBranchIds.join(', ')}` });
        }

        const [result] = await connection.execute(
            'INSERT INTO categories (name, slug, parent_id, position, active) VALUES (?, ?, ?, ?, ?)',
            [name, slug, parent_id || null, position || 0, active]
        );

        const newCategoryId = result.insertId;

        // Insert into category_branches
        if (branch_ids && branch_ids.length > 0) {
            const branchValues = branch_ids.map(branchId => [newCategoryId, branchId]);
            await connection.query(
                'INSERT INTO category_branches (category_id, branch_id) VALUES ?',
                [branchValues]
            );
        }

        await connection.commit();
        res.status(201).json({ id: newCategoryId, message: 'Danh mục đã được tạo thành công.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error creating category:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Slug danh mục đã tồn tại.' });
        }
        res.status(500).json({ message: 'Lỗi server khi tạo danh mục.' });
    } finally {
        connection.release();
    }
};

// Get category by ID
const getCategoryById = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const [rows] = await connection.execute(
            `SELECT c.id, c.name, c.slug, c.parent_id, c.position, c.active,
                    GROUP_CONCAT(b.id) AS branch_ids_csv,
                    GROUP_CONCAT(b.name) AS branch_names_csv
             FROM categories c
             LEFT JOIN category_branches cb ON c.id = cb.category_id
             LEFT JOIN branches b ON cb.branch_id = b.id
             WHERE c.id = ?
             GROUP BY c.id`,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Danh mục không tìm thấy.' });
        }

        const category = rows[0];
        // Convert CSV strings back to arrays
        category.branch_ids = category.branch_ids_csv ? category.branch_ids_csv.split(',').map(Number) : [];
        category.branch_names = category.branch_names_csv ? category.branch_names_csv.split(',') : [];
        delete category.branch_ids_csv;
        delete category.branch_names_csv;


        // Validate access to branches
        const userBranchIds = req.user.branch_ids || [];
        const accessibleBranches = category.branch_ids.filter(id => userBranchIds.includes(id));

        // If category is associated with branches the user doesn't have access to,
        // we might want to return 403 or filter out the data.
        // For simplicity, we'll just check if there's any overlap.
        if (category.branch_ids.length > 0 && accessibleBranches.length === 0 && userBranchIds.length > 0) {
             return res.status(403).json({ message: 'Bạn không có quyền truy cập danh mục này vì nó không liên quan đến chi nhánh của bạn.' });
        }


        res.json(category);
    } catch (error) {
        console.error('Error fetching category by ID:', error);
        res.status(500).json({ message: 'Lỗi server khi lấy danh mục.' });
    } finally {
        connection.release();
    }
};

// Update a category
const updateCategory = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const { name, slug, parent_id, position, active, branch_ids } = req.body;

        if (!name || !slug || !Array.isArray(branch_ids) || branch_ids.length === 0) {
            return res.status(400).json({ message: 'Tên danh mục, slug và ít nhất một chi nhánh là bắt buộc.' });
        }

        // 1. Validate branch_ids được gửi lên từ request (các chi nhánh MỚI được đề xuất)
        const userBranchIds = req.user.branch_ids || [];
        const invalidBranchIds = branch_ids.filter(bId => !userBranchIds.includes(bId));
        if (invalidBranchIds.length > 0) {
            await connection.rollback();
            return res.status(403).json({ message: `Bạn không có quyền truy cập các chi nhánh với ID: ${invalidBranchIds.join(', ')} (chi nhánh bạn muốn gán cho danh mục).` });
        }

        // 2. Kiểm tra quyền chỉnh sửa danh mục dựa trên chi nhánh HIỆN TẠI của nó
        const [existingCategoryBranchesResult] = await connection.execute(
            `SELECT cb.branch_id FROM category_branches cb WHERE cb.category_id = ?`,
            [id]
        );

        // Lấy danh sách ID chi nhánh hiện tại của danh mục
        const currentCategoryBranchIds = existingCategoryBranchesResult.map(row => row.branch_id);

        // Kiểm tra xem người dùng có quyền truy cập vào bất kỳ chi nhánh HIỆN TẠI nào của danh mục không
        const hasAccessToCurrentCategory = currentCategoryBranchIds.some(bId => userBranchIds.includes(bId));

        // Xác định xem người dùng có phải là quản trị viên toàn cầu hay không
        // Giả định `req.user.permissions` chứa một mảng các quyền, và 'admin_global' là quyền quản trị.
        // HOẶC, nếu bạn có một trường `req.user.is_admin` được thiết lập từ authMiddleware:
        const isAdmin = req.user.permissions && req.user.permissions.includes('admin_global');
        // Hoặc: const isAdmin = req.user.is_admin === true; // Tùy thuộc vào cách bạn định nghĩa admin

        // Logic quyền truy cập:
        // - Nếu danh mục hiện không có chi nhánh nào liên kết (mới hoặc chưa gán),
        //   hoặc người dùng có quyền truy cập vào ít nhất một chi nhánh hiện tại của nó,
        //   HOẶC người dùng là ADMIN, thì cho phép tiếp tục.
        // - Ngược lại, từ chối quyền.
        if (currentCategoryBranchIds.length > 0 && !hasAccessToCurrentCategory && !isAdmin) {
            await connection.rollback();
            return res.status(403).json({ message: 'Bạn không có quyền chỉnh sửa danh mục này. Danh mục này không liên quan đến chi nhánh của bạn và bạn không phải quản trị viên toàn cầu.' });
        }
        // Nếu danh mục hiện không có chi nhánh nào (currentCategoryBranchIds.length === 0),
        // và người dùng có quyền `edit_app_ql_danhmuc_sanpham` (đã được kiểm tra bởi router),
        // thì họ được phép gán chi nhánh mới.


        // Cập nhật thông tin danh mục
        await connection.execute(
            'UPDATE categories SET name = ?, slug = ?, parent_id = ?, position = ?, active = ?, updated_at = NOW() WHERE id = ?',
            [name, slug, parent_id || null, position || 0, active, id]
        );

        // Xóa tất cả liên kết chi nhánh cũ của danh mục
        await connection.execute('DELETE FROM category_branches WHERE category_id = ?', [id]);

        // Thêm các liên kết chi nhánh mới
        if (branch_ids && branch_ids.length > 0) {
            const branchValues = branch_ids.map(branchId => [id, branchId]);
            await connection.query(
                'INSERT INTO category_branches (category_id, branch_id) VALUES ?',
                [branchValues]
            );
        }

        await connection.commit();
        res.json({ message: 'Danh mục đã được cập nhật thành công.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error updating category:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Slug danh mục đã tồn tại.' });
        }
        res.status(500).json({ message: 'Lỗi server khi cập nhật danh mục.' });
    } finally {
        connection.release();
    }
};

// Delete a category
const deleteCategory = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;

        // Check if the category exists and if the user has access to it via its current branches
        const [existingCategoryRows] = await connection.execute(
            `SELECT cb.branch_id FROM categories c LEFT JOIN category_branches cb ON c.id = cb.category_id WHERE c.id = ?`,
            [id]
        );

        if (existingCategoryRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Danh mục không tìm thấy.' });
        }

        const userBranchIds = req.user.branch_ids || [];
        const currentCategoryBranchIds = existingCategoryRows.map(row => row.branch_id);
        const hasAccessToCurrentCategory = currentCategoryBranchIds.some(bId => userBranchIds.includes(bId));

        if (!hasAccessToCurrentCategory) {
            await connection.rollback();
            return res.status(403).json({ message: 'Bạn không có quyền xóa danh mục này.' });
        }

        // Deleting from `categories` will cascade delete from `category_branches` if ON DELETE CASCADE is set.
        // If not, we would need to manually delete from `category_branches` first.
        // Assuming ON DELETE CASCADE is set up for category_branches.
        const [result] = await connection.execute('DELETE FROM categories WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Danh mục không tìm thấy.' });
        }

        await connection.commit();
        res.json({ message: 'Danh mục đã được xóa thành công.' });
    } catch (error) {
        await connection.rollback();
        console.error('Error deleting category:', error);
        res.status(500).json({ message: 'Lỗi server khi xóa danh mục.' });
    } finally {
        connection.release();
    }
};

const getParentCategories = async (req, res) => {
    const connection = await pool.getConnection();
    try {
      const userBranchIds = req.user.branch_ids || [];
      const isAdmin = req.user.permissions && req.user.permissions.includes('admin_global');
  
      let query = `
        SELECT id, name, parent_id, position
        FROM categories
      `;
  
      let params = [];
  
      if (!isAdmin && userBranchIds.length > 0) {
        query += `
          WHERE EXISTS (
            SELECT 1 FROM category_branches cb
            WHERE cb.category_id = categories.id AND cb.branch_id IN (${userBranchIds.map(() => '?').join(',')})
          )
        `;
        params = userBranchIds;
      } else if (!isAdmin && userBranchIds.length === 0) {
        // Nếu user không có branch nào, trả về rỗng luôn
        connection.release();
        return res.json([]);
      }
  
      query += ` ORDER BY position ASC, name ASC`;
  
      const [rows] = await connection.execute(query, params);
      res.json(rows);
    } catch (error) {
      console.error('Error fetching parent categories:', error);
      res.status(500).json({ message: 'Lỗi server khi lấy danh mục cha.' });
    } finally {
      connection.release();
    }
  };
  
// Import categories from Excel
const importCategories = async (req, res) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Không tìm thấy file Excel.' });
        }

        const filePath = req.file.path;
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        let importedCount = 0;
        let updatedCount = 0;
        let validationErrors = [];
        let conflicts = [];

        const overwriteExisting = req.body.overwrite_existing === '1'; // Convert string to boolean

        // Fetch all existing categories for checking parent_id and slug conflicts
        const [existingCategories] = await connection.execute('SELECT id, name, slug, parent_id, position, active FROM categories');
        const existingCategoryMap = new Map(existingCategories.map(cat => [cat.slug, cat]));

        // Fetch all branches for mapping branch names/slugs to IDs
        const [allBranches] = await connection.execute('SELECT id, name, slug FROM branches');
        const branchNameToIdMap = new Map(allBranches.map(b => [b.name.toLowerCase(), b.id]));
        const branchSlugToIdMap = new Map(allBranches.map(b => [b.slug.toLowerCase(), b.id]));


        const userBranchIds = req.user.branch_ids || []; // Get branches user has access to

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const rowNum = i + 2; // Account for header row

            let {
                'Tên danh mục': name,
                'Slug': slug,
                'Danh mục cha (Slug)': parentSlug,
                'Vị trí': position,
                'Kích hoạt (có/không)': activeString,
                'Chi nhánh liên kết (tên hoặc slug, phân tách bởi dấu phẩy)': branchNamesOrSlugsCsv // NEW field
            } = row;

            let errors = [];

            if (!name) errors.push('Tên danh mục không được để trống.');
            if (!slug) errors.push('Slug không được để trống.');
            if (!branchNamesOrSlugsCsv) errors.push('Chi nhánh liên kết không được để trống.');

            // Normalize slug
            slug = slug ? String(slug).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/--+/g, '-').trim() : '';

            // Handle parent category
            let parentId = null;
            if (parentSlug) {
                const parentCat = existingCategoryMap.get(String(parentSlug).toLowerCase());
                if (parentCat) {
                    parentId = parentCat.id;
                } else {
                    errors.push(`Danh mục cha '${parentSlug}' không tồn tại.`);
                }
            }

            // Handle position
            position = typeof position === 'number' ? Math.max(0, position) : 0;

            // Handle active status
            const active = activeString && String(activeString).toLowerCase() === 'có' ? true : false;


            // Handle branch_ids
            let parsedBranchIds = [];
            let proposedBranchIdsForConflict = []; // Keep original IDs for conflict checking
            if (branchNamesOrSlugsCsv) {
                const branchStrings = String(branchNamesOrSlugsCsv).split(',').map(s => s.trim()).filter(s => s);
                for (const bStr of branchStrings) {
                    let branchId = branchNameToIdMap.get(bStr.toLowerCase()) || branchSlugToIdMap.get(bStr.toLowerCase());
                    if (branchId) {
                        // Check if the user has access to this branch
                        if (userBranchIds.includes(branchId)) {
                            parsedBranchIds.push(branchId);
                            proposedBranchIdsForConflict.push(branchId);
                        } else {
                            errors.push(`Không có quyền truy cập chi nhánh '${bStr}'.`);
                        }
                    } else {
                        errors.push(`Chi nhánh '${bStr}' không tồn tại.`);
                    }
                }
            }

            if (parsedBranchIds.length === 0 && !errors.includes('Chi nhánh liên kết không được để trống.')) {
                // Only add if it wasn't already added due to empty string
                errors.push('Không có chi nhánh liên kết hợp lệ nào được tìm thấy hoặc bạn không có quyền truy cập.');
            }


            if (errors.length > 0) {
                validationErrors.push({ row: rowNum, errors });
                continue;
            }

            const existingCategory = existingCategoryMap.get(slug);

            if (existingCategory) {
                // If category exists and overwrite is true, update
                if (overwriteExisting) {
                    // Check if the user has access to update this specific existing category
                    const [currentCategoryBranches] = await connection.execute(
                        `SELECT branch_id FROM category_branches WHERE category_id = ?`,
                        [existingCategory.id]
                    );
                    const currentCategoryBranchIds = currentCategoryBranches.map(row => row.branch_id);
                    const hasAccessToExistingCategory = currentCategoryBranchIds.some(bId => userBranchIds.includes(bId));

                    if (!hasAccessToExistingCategory) {
                        errors.push(`Bạn không có quyền cập nhật danh mục '${name}' (ID: ${existingCategory.id}) vì nó không liên quan đến chi nhánh của bạn.`);
                        validationErrors.push({ row: rowNum, errors });
                        continue;
                    }

                    // Update category details
                    await connection.execute(
                        'UPDATE categories SET name = ?, parent_id = ?, position = ?, active = ?, updated_at = NOW() WHERE id = ?',
                        [name, parentId, position, active, existingCategory.id]
                    );

                    // Update category_branches: delete old, insert new
                    await connection.execute('DELETE FROM category_branches WHERE category_id = ?', [existingCategory.id]);
                    if (parsedBranchIds.length > 0) {
                        const branchValues = parsedBranchIds.map(branchId => [existingCategory.id, branchId]);
                        await connection.query(
                            'INSERT INTO category_branches (category_id, branch_id) VALUES ?',
                            [branchValues]
                        );
                    }
                    updatedCount++;
                } else {
                    // If category exists and overwrite is false, add to conflicts
                    // Fetch existing branch_ids for the conflict report
                    const [existingBranchRows] = await connection.execute(
                        `SELECT branch_id FROM category_branches WHERE category_id = ?`,
                        [existingCategory.id]
                    );
                    const existingBranchIds = existingBranchRows.map(row => row.branch_id);

                    conflicts.push({
                        row: rowNum,
                        existing: {
                            id: existingCategory.id,
                            name: existingCategory.name,
                            slug: existingCategory.slug,
                            parent_id: existingCategory.parent_id,
                            position: existingCategory.position,
                            active: existingCategory.active,
                            branch_ids: existingBranchIds, // Pass existing branch IDs
                        },
                        proposed: {
                            name: name,
                            slug: slug,
                            parent_id: parentId,
                            position: position,
                            active: active,
                            branch_ids: proposedBranchIdsForConflict // Pass proposed branch IDs
                        }
                    });
                }
            } else {
                // Insert new category
                const [result] = await connection.execute(
                    'INSERT INTO categories (name, slug, parent_id, position, active) VALUES (?, ?, ?, ?, ?)',
                    [name, slug, parentId, position, active]
                );
                const newCategoryId = result.insertId;

                // Insert into category_branches
                if (parsedBranchIds.length > 0) {
                    const branchValues = parsedBranchIds.map(branchId => [newCategoryId, branchId]);
                    await connection.query(
                        'INSERT INTO category_branches (category_id, branch_id) VALUES ?',
                        [branchValues]
                    );
                }
                importedCount++;
            }
        }

        if (validationErrors.length > 0 || conflicts.length > 0) {
             // Rollback if there are any validation errors (meaning some rows failed completely)
            // Or if there are conflicts that were not overwritten.
            // However, the current logic processes valid rows even if others have validation errors.
            // If the requirement is to rollback the entire batch on any error, then this rollback
            // should be unconditional if validationErrors.length > 0.
            // For now, we commit successfully processed rows and report errors/conflicts.
            // If you want a full rollback on ANY error, uncomment the line below.
            // await connection.rollback(); 
            await connection.commit(); // Commit what was successfully processed.

            // Send 400 status if there are validation errors, but still return details
            // If you want 200 OK even with errors/conflicts, change this.
            return res.status(200).json({ // Changed to 200 as per frontend expectation for partial success reports
                message: 'Có lỗi hoặc xung đột trong dữ liệu nhập.',
                validationErrors,
                conflicts,
                imported_count: importedCount, // Still report counts of what was processed
                updated_count: updatedCount
            });
        }

        await connection.commit();
        // fs.unlinkSync(filePath); // Xóa file tạm - ensure this is outside try/catch if you want it always

        let message = `Đã nhập thành công ${importedCount} danh mục.`;
        if (updatedCount > 0) {
            message += ` Đã cập nhật ${updatedCount} danh mục đã tồn tại.`;
        }

        res.status(200).json({
            message: message,
            imported_count: importedCount,
            updated_count: updatedCount,
            validation_errors: validationErrors, // Should be empty here
            conflicts: conflicts // Should be empty here
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error importing categories:', error);
        res.status(500).json({ message: 'Lỗi server khi nhập danh mục', error: error.message });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) { // Ensure file exists before deleting
            try {
                fs.unlinkSync(req.file.path); // Xóa file tạm
            } catch (unlinkErr) {
                console.error('Error deleting temp file:', unlinkErr);
            }
        }
        connection.release();
    }
};

// Export categories to Excel
const exportCategories = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.execute(
            `SELECT
                c.name AS 'Tên danh mục',
                c.slug AS 'Slug',
                pc.slug AS 'Danh mục cha (Slug)',
                c.position AS 'Vị trí',
                CASE WHEN c.active THEN 'có' ELSE 'không' END AS 'Kích hoạt (có/không)',
                GROUP_CONCAT(b.slug SEPARATOR ', ') AS 'Chi nhánh liên kết (tên hoặc slug, phân tách bởi dấu phẩy)'
            FROM categories c
            LEFT JOIN categories pc ON c.parent_id = pc.id
            LEFT JOIN category_branches cb ON c.id = cb.category_id
            LEFT JOIN branches b ON cb.branch_id = b.id
            GROUP BY c.id
            ORDER BY c.position ASC, c.name ASC`
        );

        const worksheet = xlsx.utils.json_to_sheet(rows);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Danh mục Sản phẩm');

        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', 'attachment; filename=danh_muc_san_pham.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        console.error('Error exporting categories:', error);
        res.status(500).json({ message: 'Lỗi server khi xuất danh mục.' });
    } finally {
        connection.release();
    }
};


module.exports = {
    index,
    createCategory,
    getCategoryById,
    updateCategory,
    deleteCategory,
    getParentCategories,
    importCategories,
    exportCategories
};