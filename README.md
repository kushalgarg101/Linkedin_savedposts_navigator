# <img src="assets/icons/icon.svg" width="48" height="48" valign="middle"> LinkedIn Saved Navigator

A powerful Chrome/Edge extension to index, search, and filter your LinkedIn saved posts with a modern, user-friendly interface. ✨

## 🚀 Features

- **Quick Access Button**: Integrated directly into LinkedIn's "My items" sidebar menu 🖱️
- **Smart Syncing**: 🔄
  - **Sync**: Fetch all saved posts
  - **Clear & Resync**: Start fresh with a complete re-index
- **Rich Filters**: 🔍
  - **Author**: Dropdown with all authors and their post counts
  - **Content Type**: Post, Article, Video, Document, Image
  - **Date Range**: Filter by from/to dates
- **Local Storage**: All data stored securely in your browser's IndexedDB 🛡️

## 🛠️ Installation (Developer Mode)

1. Clone or download this repository
2. Open `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the project folder

## 📖 How to Use

1. Navigate to your [LinkedIn Saved Posts](https://www.linkedin.com/my-items/saved-posts/)
2. Click **Saved Navigator** in the "My items" sidebar menu
3. Click **Sync** to start indexing your posts
4. Use the search bar and filters to find posts
5. Click **Open Post** to view the original, or **Open Profile** to visit the author's profile

## 🖥️ Interface

### 🛠️ Toolbar
- **Toggle (▲/▼)**: Collapse/expand the filters section
- **Search**: Execute the search with current filters
- **Clear**: Reset all filters
- **Results Count**: Real-time feedback on matches

### 🔍 Filters
- **Search Box**: Full-text search with autocomplete suggestions
- **Author Dropdown**: Select from all indexed authors
- **Content Type**: Filter by post type
- **More Filters**: Date range (from/to)

## 🧪 Testing

### Unit Tests
```bash
npm test
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit pull requests.

---
*Built with ❤️ for better LinkedIn navigation.*
