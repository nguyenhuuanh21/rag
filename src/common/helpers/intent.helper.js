
const INTENT = {
    GREETING: "GREETING",       // Chào hỏi thuần túy
    FAREWELL: "FAREWELL",       // Tạm biệt thuần túy
    THANKS: "THANKS",         // Cảm ơn thuần túy
    HELP: "HELP",           // Hỏi về khả năng của bot
    IDENTITY: "IDENTITY",       // Hỏi bot là ai
    FOLLOWUP: "FOLLOWUP",       // Câu hỏi tiếp theo về chủ đề trước
    UNCLEAR: "UNCLEAR",        // Quá ngắn / vô nghĩa
    DOCUMENT_QUERY: "DOCUMENT_QUERY", // Câu hỏi thật sự → cần chạy RAG
};

const SIMPLE_RESPONSES = {
    [INTENT.GREETING]:
        "Xin chào! Tôi là trợ lý tư vấn sinh viên của Trường Đại học Giao thông vận tải (UTC).\n" +
        "Tôi có thể giúp bạn tra cứu thông tin trong Sổ tay sinh viên khóa 63, bao gồm:\n\n" +
        "- Quy chế đào tạo (tín chỉ, thi cử, học lại, tốt nghiệp)\n" +
        "- Học phí, học bổng, miễn giảm học phí, vay vốn\n" +
        "- Quy định rèn luyện và xếp loại sinh viên\n" +
        "- Kỷ luật sinh viên và các thủ tục hành chính\n" +
        "- Ký túc xá, thư viện, y tế, bảo hiểm\n" +
        "- Địa chỉ và số điện thoại các phòng ban\n\n" +
        "Bạn muốn hỏi gì?",

    [INTENT.FAREWELL]:
        "Tạm biệt! Chúc bạn học tập tốt tại trường UTC. " +
        "Khi cần tra cứu thông tin trong Sổ tay sinh viên, hãy hỏi tôi bất cứ lúc nào nhé!",

    [INTENT.THANKS]:
        "Không có gì! Nếu bạn còn câu hỏi nào về Sổ tay sinh viên UTC, tôi luôn sẵn sàng hỗ trợ.",

    [INTENT.HELP]:
        "Tôi là trợ lý tra cứu Sổ tay sinh viên UTC khóa 63 hệ chính quy. Tôi có thể giúp bạn:\n\n" +
        "- Tra cứu quy chế đào tạo (tín chỉ, thi cử, học lại, điều kiện tốt nghiệp)\n" +
        "- Thông tin học phí, học bổng, miễn giảm học phí, vay vốn tín dụng\n" +
        "- Quy định đánh giá rèn luyện và xếp loại sinh viên\n" +
        "- Thủ tục kỷ luật và chấm dứt kỷ luật\n" +
        "- Hướng dẫn đăng ký học, tài khoản đào tạo\n" +
        "- Thông tin ký túc xá, thư viện, y tế, bảo hiểm\n" +
        "- Địa chỉ, số điện thoại các phòng ban trong trường\n\n" +
        "Hãy đặt câu hỏi cụ thể để tôi hỗ trợ chính xác nhất!",

    [INTENT.IDENTITY]:
        "Tôi là trợ lý tư vấn sinh viên chính thức của Trường Đại học Giao thông vận tải (UTC), " +
        "được xây dựng từ nội dung Sổ tay sinh viên khóa 63 hệ chính quy. " +
        "Tôi chỉ có thể trả lời các câu hỏi liên quan đến tài liệu này — " +
        "nếu bạn hỏi ngoài phạm vi tài liệu, tôi sẽ thông báo để tránh nhầm lẫn.",

    [INTENT.UNCLEAR]:
        "Bạn có thể nói rõ hơn câu hỏi của mình không? " +
        "Ví dụ: \"Điều kiện để được học bổng là gì?\" hoặc \"Quy trình nộp đơn miễn giảm học phí như thế nào?\". " +
        "Tôi có thể giúp tra cứu thông tin về quy chế đào tạo, học phí, học bổng, " +
        "kỷ luật, thủ tục hành chính và nhiều nội dung khác trong Sổ tay sinh viên UTC.",
};


function classifyIntent(query) {
    const q = query.trim();
    const lower = q.toLowerCase();

    if (q.length < 2 || /^[\s?.!,\-_\d]+$/.test(q)) {
        return INTENT.UNCLEAR;
    }

    if (q.length > 30) {
        return INTENT.DOCUMENT_QUERY;
    }

    if (!lower.includes("?") && (
        /^(xin chào|chào|hello|hi|hey|alo|halo)\b/i.test(lower) ||
        /^(good morning|good afternoon|good evening)\b/i.test(lower)
    )) {
        return INTENT.GREETING;
    }

    if (/\b(tạm biệt|tam biet|bye+|goodbye|hẹn gặp|hẹn gặp lại|đăng xuất|thoát)\b/i.test(lower)) {
        return INTENT.FAREWELL;
    }

    if (!lower.includes("?") &&
        /(cảm ơn|cam on|camon|thanks|thank you|thks|tks|ty)\b/i.test(lower)) {
        return INTENT.THANKS;
    }

    if (/^còn (gì|nữa|không|thêm)/i.test(lower) ||
        /^(nói thêm|cho biết thêm|thêm thông tin)/i.test(lower) ||
        /^(chi tiết hơn|cụ thể hơn|giải thích thêm)/i.test(lower) ||
        /^(tiếp tục|tiếp theo|và gì nữa)/i.test(lower) ||
        /^(ví dụ|cho ví dụ|ví dụ cụ thể)/i.test(lower) ||
        /^(tại sao vậy|sao vậy|vì sao vậy)/i.test(lower)) {
        return INTENT.FOLLOWUP;
    }

    if (/làm được gì/i.test(lower) ||
        /hỗ trợ (gì|được gì)/i.test(lower) ||
        /giúp (gì|được gì)/i.test(lower) ||
        /biết (gì|những gì)/i.test(lower) ||
        /what can you/i.test(lower) ||
        /chức năng (gì|nào)/i.test(lower)) {
        return INTENT.HELP;
    }

    if (/bạn là ai/i.test(lower) ||
        /bạn tên (là )?gì/i.test(lower) ||
        /who are you/i.test(lower) ||
        /mày là ai/i.test(lower)) {
        return INTENT.IDENTITY;
    }

    return INTENT.DOCUMENT_QUERY;
}

const ABBREVIATION_MAP = [
    [/\bsv\b/gi, "sinh viên"],
    [/\bhp\b/gi, "học phí"],
    [/\bhb\b/gi, "học bổng"],
    [/\bktx\b/gi, "ký túc xá"],
    [/\bcvht\b/gi, "cố vấn học tập"],
    [/\bbhyt\b/gi, "bảo hiểm y tế"],
    [/\bgpa\b/gi, "điểm trung bình tích lũy"],
    [/\bkl\b/gi, "kỷ luật"],
    [/\brl\b/gi, "rèn luyện sinh viên"],
    [/\bpdt\b/gi, "phòng đào tạo"],
    [/\bhssv\b/gi, "hồ sơ sinh viên"],
    [/\bpctssv\b/gi, "phòng công tác sinh viên"],
    [/\btc\b/gi, "tín chỉ"],
    [/\bhk\b/gi, "học kỳ"],
    [/\bnh\b/gi, "năm học"],
    [/\bđtb\b/gi, "điểm trung bình"],
    [/\bđatn\b/gi, "đồ án tốt nghiệp"],
    [/\btttn\b/gi, "thực tập tốt nghiệp"],
    [/\bqldt\b/gi, "quản lý đào tạo"],
    [/\bctdt\b/gi, "chương trình đào tạo"],
    [/\bnckh\b/gi, "nghiên cứu khoa học"],
    [/\bpdt\b/gi, "phòng đào tạo"],
];


function expandAbbreviations(query) {
    let result = query;
    for (const [pattern, replacement] of ABBREVIATION_MAP) {
        result = result.replace(pattern, replacement);
    }
    return result;
}


function sanitizeInput(input) {
    return input
        .replace(/<\/?system>/gi, "")
        .replace(/<\/?instruction[^>]*>/gi, "")
        .replace(/ignore\s+(previous|all|above|prior)\s+(instructions?|prompts?|context)/gi, "")
        .trim();
}

module.exports = { INTENT, SIMPLE_RESPONSES, classifyIntent, expandAbbreviations, sanitizeInput };