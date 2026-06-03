

// function extractBreadcrumbAndContent(rawContent) {
//     const text = rawContent.trim();
//     const idx = text.indexOf("\n\n");
//     if (idx === -1) return { breadcrumb: null, mainContent: text };

//     const firstLine = text.slice(0, idx).trim();
//     const rest = text.slice(idx + 2).trim();

//     if (firstLine.startsWith("#")) {
//         const breadcrumb = firstLine.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim();
//         return { breadcrumb, mainContent: rest || text };
//     }
//     return { breadcrumb: null, mainContent: text };
// }

// function buildContextText(topChunks) {
//     return topChunks
//         .map((doc, i) => {
//             const pages = doc.pages || [];
//             const pageInfo =
//                 pages.length === 0 ? "Không rõ trang" :
//                 pages.length === 1 ? `Trang ${pages[0]}` :
//                 `Trang ${pages[0]}–${pages[pages.length - 1]}`;

//             const { breadcrumb, mainContent } = extractBreadcrumbAndContent(doc.content);
//             const sourceInfo = breadcrumb
//                 ? `Nguồn: ${breadcrumb} — ${pageInfo}`
//                 : `Vị trí: ${pageInfo}`;

//             return `[Đoạn ${i + 1}] ${sourceInfo}\n---\n${mainContent}`;
//         })
//         .join("\n\n");
// }
function buildContextText(topChunks) {
    return topChunks
        .map((doc, i) => {
            return `[Đoạn ${i + 1}]\n---\n${doc.content}`;
        })
        .join("\n\n");
}
module.exports = { buildContextText };
