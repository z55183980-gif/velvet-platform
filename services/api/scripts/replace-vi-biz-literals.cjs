const fs = require("fs");
const path = require("path");

const map = {
  "Không tìm thấy phim": "drama.notFound",
  "Đơn hàng không tồn tại": "order.notFound",
  "Không có quyền": "common.forbidden",
  "Yêu cầu đã được xử lý": "request.alreadyProcessed",
  "Không có trường nào để cập nhật": "common.noFieldsToUpdate",
  "Lý do là bắt buộc": "common.reasonRequired",
  "Không tìm thấy tập": "episode.notFound",
  "basePrice phải > 0": "validation.basePricePositive",
  "Cần đăng nhập tài khoản quản trị": "admin.loginRequired",
  "Email/username hoặc mật khẩu không đúng": "admin.badCredentials",
  "Không tìm thấy creator": "creator.notFound",
  "Lý do từ chối là bắt buộc": "common.rejectReasonRequired",
  "Đơn hàng đã hoàn tiền, không thể đánh dấu PAID": "order.alreadyRefundedCannotMarkPaid",
  "Tập phim không tồn tại": "episode.notFound",
  "Email không hợp lệ": "email.invalid",
  "Username không hợp lệ": "username.invalid",
  "Phiên quản trị không hợp lệ": "admin.sessionInvalid",
  "KYC đã được xử lý": "kyc.alreadyProcessed",
  "Yêu cầu không tồn tại": "request.notFound",
  "endAt phải sau startAt": "validation.endAfterStart",
  "ids trống": "ids.empty",
  "Đơn chưa thanh toán, không thể yêu cầu hoàn": "order.unpaidCannotRefund",
  "Loại đơn này không hỗ trợ hoàn": "order.typeNoRefund",
  "Không tìm thấy người dùng": "user.notFound",
  "Người dùng không tồn tại": "user.notFound",
  "Cập nhật ví thất bại, vui lòng thử lại": "wallet.updateFailed",
  "Không tìm thấy": "common.notFound",
  "credits phải > 0": "validation.creditsPositive",
  "Mã đã được sử dụng": "code.alreadyUsed",
  "Tập không tồn tại": "episode.notFound",
  "dramaId không hợp lệ": "validation.dramaIdInvalid",
  "durationDays phải >= 1": "validation.durationDaysMin",
  "Đơn hàng chưa thanh toán, không thể hoàn": "order.unpaidCannotCompleteRefund",
  "Không có quyền quản trị": "admin.forbidden",
  "Thao tác dữ liệu thất bại": "common.dataOpFailed",
  "Dữ liệu đã tồn tại": "common.recordExists",
  "Tham chiếu không hợp lệ": "common.invalidReference",
  "Không tìm thấy bản ghi": "common.recordNotFound",
  "Dữ liệu không hợp lệ": "common.invalidData",
  "Cập nhật ví thất bại": "wallet.updateFailed",
  "Số dư không đủ": "wallet.insufficientBalance",
};

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

let changed = 0;
let repl = 0;
for (const f of walk(path.join(__dirname, "../src"))) {
  if (f.includes(`${path.sep}i18n${path.sep}`)) continue;
  let text = fs.readFileSync(f, "utf8");
  const orig = text;
  for (const [lit, key] of Object.entries(map)) {
    const single = `'${lit}'`;
    const singleKey = `'${key}'`;
    if (text.includes(single)) {
      const n = text.split(single).length - 1;
      text = text.split(single).join(singleKey);
      repl += n;
    }
  }
  if (text !== orig) {
    fs.writeFileSync(f, text);
    changed += 1;
  }
}
console.log(`files ${changed} replacements ${repl}`);
