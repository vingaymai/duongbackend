// duongbackend/middleware/authorizeMiddleware.js

/**
 * Middleware để kiểm tra quyền hạn của người dùng.
 * permissionsNeeded có thể là một chuỗi quyền ('view users') hoặc một mảng quyền (['view users', 'manage users']).
 *
 * @param {...string} permissionsNeeded - Các quyền cần thiết để truy cập route.
 * @returns {function} - Middleware function (req, res, next).
 */
const authorize = (...permissionsNeeded) => {
    
    return (req, res, next) => {
        // req.user được gắn bởi middleware 'protect'
        console.log(`[Authorize Middleware]`,
            {
              required: permissionsNeeded,
              userPermissions: req.user.permissions,
            });
                       
        if (!req.user || !req.user.id || !req.user.roles || !req.user.permissions) {
            return res.status(401).json({ message: 'Không được ủy quyền, thông tin người dùng không đầy đủ.' });
        }

        const userRoles = req.user.roles;
        const userPermissions = req.user.permissions;

        // Kiểm tra nếu người dùng là Admin (có vai trò 'Admin')
        const isAdmin = userRoles.some(role => role.name === 'Admin');

        // Nếu người dùng là Admin, cho phép truy cập luôn
        if (isAdmin) {
            return next();
        }

        // Nếu không phải Admin, kiểm tra từng quyền cần thiết
        const hasRequiredPermission = permissionsNeeded.some(permission =>
            userPermissions.includes(permission)
        );

        if (hasRequiredPermission) {
            next(); // Cho phép truy cập
        } else {
            res.status(403).json({ message: 'Bạn không có đủ quyền để thực hiện thao tác này. liên hệ quản trị' });
        }
    };
};

module.exports = { authorize };