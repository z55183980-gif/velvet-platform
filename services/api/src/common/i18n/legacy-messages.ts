import type { MessageKey } from './messages';

/**
 * Map historical hardcoded BizException literals → catalog keys.
 * Prefer throwing keys at call sites; this keeps older Vietnamese (and mixed) strings
 * localizable via Accept-Language until fully migrated.
 */
export const LEGACY_MESSAGE_LITERALS: Record<string, MessageKey> = {
  // Prisma (pre-key)
  'Thao tác dữ liệu thất bại': 'common.dataOpFailed',
  'Dữ liệu đã tồn tại': 'common.recordExists',
  'Tham chiếu không hợp lệ': 'common.invalidReference',
  'Không tìm thấy bản ghi': 'common.recordNotFound',
  'Dữ liệu không hợp lệ': 'common.invalidData',

  // Common
  'Không tìm thấy': 'common.notFound',
  'Không có quyền': 'common.forbidden',
  'Không có trường nào để cập nhật': 'common.noFieldsToUpdate',
  'Lý do là bắt buộc': 'common.reasonRequired',
  'Lý do từ chối là bắt buộc': 'common.rejectReasonRequired',

  // Admin
  'Cần đăng nhập tài khoản quản trị': 'admin.loginRequired',
  'Phiên quản trị không hợp lệ': 'admin.sessionInvalid',
  'Email/username hoặc mật khẩu không đúng': 'admin.badCredentials',
  'Không có quyền quản trị': 'admin.forbidden',
  'Đã có tài khoản quản trị, không thể bootstrap': 'admin.bootstrapExists',
  'Email đã được sử dụng': 'admin.emailTaken',
  'Username đã được sử dụng': 'admin.usernameTaken',
  'Mật khẩu cũ không đúng': 'admin.oldPasswordWrong',

  // Domain
  'Không tìm thấy phim': 'drama.notFound',
  'Không tìm thấy tập': 'episode.notFound',
  'Tập phim không tồn tại': 'episode.notFound',
  'Tập không tồn tại': 'episode.notFound',
  'Đơn hàng không tồn tại': 'order.notFound',
  'Đơn hàng đã hoàn tiền, không thể đánh dấu PAID': 'order.alreadyRefundedCannotMarkPaid',
  'Đơn chưa thanh toán, không thể yêu cầu hoàn': 'order.unpaidCannotRefund',
  'Loại đơn này không hỗ trợ hoàn': 'order.typeNoRefund',
  'Đơn hàng chưa thanh toán, không thể hoàn': 'order.unpaidCannotCompleteRefund',
  'Yêu cầu đã được xử lý': 'request.alreadyProcessed',
  'Yêu cầu không tồn tại': 'request.notFound',
  'Không tìm thấy creator': 'creator.notFound',
  'Không tìm thấy người dùng': 'user.notFound',
  'Người dùng không tồn tại': 'user.notFound',
  'KYC đã được xử lý': 'kyc.alreadyProcessed',
  'Cập nhật ví thất bại, vui lòng thử lại': 'wallet.updateFailed',
  'Cập nhật ví thất bại': 'wallet.updateFailed',
  'Số dư không đủ': 'wallet.insufficientBalance',
  'Mã đã được sử dụng': 'code.alreadyUsed',
  'ids trống': 'ids.empty',
  'Email không hợp lệ': 'email.invalid',
  'Username không hợp lệ': 'username.invalid',
  'basePrice phải > 0': 'validation.basePricePositive',
  'credits phải > 0': 'validation.creditsPositive',
  'durationDays phải >= 1': 'validation.durationDaysMin',
  'endAt phải sau startAt': 'validation.endAfterStart',
  'dramaId không hợp lệ': 'validation.dramaIdInvalid',
};

/** Patterns for interpolated Vietnamese leftovers → key + params. */
export const LEGACY_MESSAGE_PATTERNS: Array<{
  re: RegExp;
  key: MessageKey;
  params?: (match: RegExpMatchArray) => Record<string, string | number>;
}> = [
  {
    re: /^Dữ liệu đã tồn tại \((.+)\)$/,
    key: 'common.recordExistsField',
    params: (m) => ({ field: m[1] }),
  },
  {
    re: /^缺少必要字段 (.+)$/,
    key: 'common.missingField',
    params: (m) => ({ field: m[1] }),
  },
];
