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

  // Auth / playback
  'Chưa đăng nhập': 'auth.notLoggedIn',
  'Tập này cần mở khóa để xem': 'episode.unlockRequired',
  'progressSec không hợp lệ': 'validation.progressSecInvalid',
  'progressSec vượt quá giới hạn': 'validation.progressSecTooLarge',

  // Wallet / orders
  'Phim không tồn tại': 'drama.notFound',
  'Drama không tồn tại': 'drama.notFound',
  'Phim này không hỗ trợ mua cả bộ': 'drama.buyoutUnsupported',
  'Số dư credits không đủ để mua cả bộ': 'wallet.insufficientForBuyout',
  'Số dư không đủ để mở tập này': 'wallet.insufficientForUnlock',
  'Số dư chưa đủ để rút': 'wallet.insufficientForWithdraw',
  'Đơn nạp không hỗ trợ tự hoàn tiền, vui lòng liên hệ quản trị':
    'order.topupSelfRefundForbidden',
  'Loại đơn này không hỗ trợ hoàn tiền': 'order.typeNoRefund',
  'Loại đơn không hỗ trợ hoàn': 'order.typeNoRefund',
  'Hoàn tiền thất bại, vui lòng thử lại': 'wallet.refundFailed',
  'Chỉ dùng cho đơn nạp': 'order.topupOnly',
  'Ví đang bận, thử lại': 'wallet.busy',
  'Ví rỗng, không thể trừ': 'wallet.emptyCannotDebit',
  'Đơn đã được xử lý': 'request.alreadyProcessed',
  'Đơn đã hoàn/đang xử lý': 'order.alreadyRefundedOrPending',
  'Đơn chưa thanh toán': 'order.unpaidCannotCompleteRefund',

  // Redeem codes
  'Mã không hợp lệ': 'code.invalid',
  'Mã không tồn tại': 'code.notFound',
  'Mã đã bị vô hiệu': 'code.voided',
  'Mã đã hết hạn': 'code.expired',

  // Packages / plans / banners / favorites
  'Gói nạp không hợp lệ': 'topupPackage.invalid',
  'Gói nạp không tồn tại hoặc đã tắt': 'topupPackage.notFoundOrDisabled',
  'Gói nạp không tồn tại': 'topupPackage.notFound',
  'Gói VIP không tồn tại hoặc đã tắt': 'vipPlan.notFoundOrDisabled',
  'Gói VIP không tồn tại': 'vipPlan.notFound',
  'Banner không tồn tại': 'banner.notFound',
  'Chưa yêu thích phim này': 'favorite.notFound',

  // Creator lifecycle / KYC
  'Chỉ xoá được phim ở trạng thái DRAFT': 'drama.deleteDraftOnly',
  'Chỉ có thể gỡ phim đang LIVE': 'drama.unpublishLiveOnly',
  'Chỉ xoá được tập của phim DRAFT/REJECTED': 'episode.deleteDraftRejectedOnly',
  'Trạng thái hiện tại không cho phép gửi duyệt': 'drama.submitReviewNotAllowed',
  'Tập miễn phí không được đặt giá > 0': 'episode.freePriceMustBeZero',
  'Tập trả phí cần priceVnd hoặc priceCredits > 0': 'episode.paidPriceRequired',
  'cccdNumber phải là 9 hoặc 12 chữ số': 'validation.cccdNumber',
  'cccdFrontUrl phải là https://、/api/v1/media/ 或 docs/': 'validation.cccdFrontUrl',
  'cccdBackUrl phải là https://、/api/v1/media/ 或 docs/': 'validation.cccdBackUrl',
  'faceVerified phải là true': 'validation.faceVerifiedRequired',
  'taxCode là bắt buộc': 'validation.taxCodeRequired',
  'bankAccount là bắt buộc': 'creator.bankAccountRequired',

  // Admin
  'Admin không tồn tại': 'admin.notFound',
  'Kênh thanh toán không hỗ trợ': 'payment.channelUnsupported',

  // Validation
  'from/to không hợp lệ': 'validation.dateRangeInvalid',
  'Số tiền không hợp lệ': 'validation.amountInvalid',
  'episodeNumber không hợp lệ': 'validation.episodeNumberInvalid',
  'priceVnd phải >= 0': 'validation.priceVndMin',
  'priceCredits phải >= 0': 'validation.priceCreditsMin',
  'priceCredits không hợp lệ': 'validation.priceCreditsInvalid',
  'VIP plan duration không hợp lệ': 'validation.vipDurationInvalid',
  'VIP days không hợp lệ': 'validation.vipDaysInvalid',
  'Credits không hợp lệ': 'validation.creditsInvalid',
  'quantity phải trong 1..5000': 'validation.quantityRange',
  'type phải là VIP hoặc CREDITS': 'validation.redeemType',
  'vipDays phải >= 1': 'validation.vipDaysMin',
  'creditsAmount phải > 0': 'validation.creditsAmountPositive',
  'expiresAt không hợp lệ': 'validation.expiresAtInvalid',
  'deltaCredits không được = 0': 'validation.deltaCreditsNonZero',
  'extendDays không hợp lệ': 'validation.extendDaysInvalid',
  'vipExpireAt không hợp lệ': 'validation.vipExpireAtInvalid',
  'Cần vipExpireAt hoặc extendDays': 'validation.vipExtendRequired',
  'relativePath không hợp lệ': 'validation.relativePathInvalid',
  'startAt/endAt không hợp lệ': 'validation.startEndInvalid',
  'startAt không hợp lệ': 'validation.startAtInvalid',
  'endAt không hợp lệ': 'validation.endAtInvalid',
  'freeEpisodeCount không hợp lệ': 'validation.freeEpisodeCountInvalid',
  'lockMode không hợp lệ': 'validation.lockModeInvalid',
  'buyoutCredits không hợp lệ': 'validation.buyoutCreditsInvalid',
  'sortWeight không hợp lệ': 'validation.sortWeightInvalid',
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
  {
    re: /^Yêu cầu quyền: (.+)$/,
    key: 'admin.roleRequired',
    params: (m) => ({ roles: m[1] }),
  },
  {
    re: /^Tập không thuộc drama: (.+)$/,
    key: 'episode.notInDrama',
    params: (m) => ({ id: m[1] }),
  },
  {
    re: /^Không thể xoá: có (\d+) phim đang dùng danh mục này$/,
    key: 'category.hasDramas',
    params: (m) => ({ count: m[1] }),
  },
  {
    re: /^Không thể xoá: có (\d+) đơn hàng liên quan\. Hãy OFFLINE thay vì xoá\.$/,
    key: 'drama.hasOrdersCannotDelete',
    params: (m) => ({ count: m[1] }),
  },
  {
    re: /^Đơn hàng paymentMethod=(.+) không chấp nhận webhook (.+)$/,
    key: 'payment.webhookMethodMismatch',
    params: (m) => ({ method: m[1], provider: m[2] }),
  },
  {
    re: /^Provider (.+) không khớp paymentMethod=(.+)$/,
    key: 'payment.providerMethodMismatch',
    params: (m) => ({ provider: m[1], method: m[2] }),
  },
  {
    re: /^mime không hợp lệ: (.+)$/,
    key: 'validation.mimeInvalid',
    params: (m) => ({ mime: m[1] }),
  },
  {
    re: /^Invalid mime: (.+)$/,
    key: 'validation.mimeInvalid',
    params: (m) => ({ mime: m[1] }),
  },
];
