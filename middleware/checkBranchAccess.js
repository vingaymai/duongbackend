module.exports = (req, res, next) => {
    console.log('User branch IDs:', req.user?.branch_ids);
    console.log('Request params:', req.params);
    console.log('Request body:', req.body);

    const userBranchIds = req.user?.branch_ids;

    if (!userBranchIds || !Array.isArray(userBranchIds)) {
        return res.status(403).json({ message: 'Không xác định được quyền truy cập chi nhánh.' });
    }

    // Lấy branch_id từ params hoặc body
    let requestedBranchIdRaw;

    if ('branch_id' in req.params) {
        requestedBranchIdRaw = req.params.branch_id;
    } else if (req.body && 'branch_id' in req.body) {
        requestedBranchIdRaw = req.body.branch_id;
    }

    // Nếu không có branch_id thì cho phép next() vì có thể route không cần kiểm tra branch
    if (requestedBranchIdRaw === undefined) {
        return next();
    }

    const requestedBranchId = Number(requestedBranchIdRaw);

    if (isNaN(requestedBranchId)) {
        return res.status(400).json({ message: 'ID chi nhánh không hợp lệ.' });
    }

    if (!userBranchIds.includes(requestedBranchId)) {
        return res.status(403).json({ message: 'Không có quyền truy cập chi nhánh này.' });
    }

    next();
};
