// Hàm nhận diện trang Mục lục (Table of Contents)
const isTableOfContents = (text) => {
    if (!text || text.trim().length === 0) return false;

    // 1. Kiểm tra xem 500 ký tự đầu tiên có chứa chữ "MỤC LỤC" không
    // (Lấy 500 ký tự đầu để tránh trường hợp văn bản bình thường vô tình nhắc đến từ "mục lục")
    const headerText = text.slice(0, 500).toUpperCase();
    const hasTocKeyword = headerText.includes("MỤC LỤC");

    // 2. Đếm số lượng dòng có chứa chuỗi dấu chấm dài (từ 5 dấu chấm trở lên)
    // Đây là đặc điểm "chí mạng" nhất của định dạng mục lục PDF
    const dotLeaderMatches = text.match(/\.{5,}/g);
    const dotLeaderCount = dotLeaderMatches ? dotLeaderMatches.length : 0;

    // Trả về true (là mục lục) nếu: Có từ khóa HOẶC có nhiều hơn 5 dòng chứa dấu chấm
    return hasTocKeyword || dotLeaderCount > 5;
};
module.exports = isTableOfContents;