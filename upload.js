const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  });

// Настройка multer: лимит 5MB, сохраняем в папку uploads/
const upload = multer({
    storage: storage,
     limits: { fileSize: 10 * 1024 * 1024 }, // Лимит 5MB
});

// Маршрут для загрузки файла
router.post("/upload", upload.array("files", 5), (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Файлы не загружены!" });
    }
  
    const filepaths = req.files.map(file => `/uploads/${file.filename}`);
  
    res.json({
      message: "Файлы успешно загружены!",
      filepaths, // Отправляем массив ссылок
    });
  });

  router.delete("/delete/:filename", (req, res) => {
    const filename = req.params.filename;
    const filePath = path.resolve(__dirname, "uploads", filename);

    console.log("Попытка удаления файла:", filename);

    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            console.error("Файл не найден:", filePath);
            return res.status(404).json({ error: "Файл не найден!" });
        }

        fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
                console.error("Ошибка при удалении файла:", unlinkErr);
                return res.status(500).json({ error: "Ошибка при удалении файла!" });
            }

            console.log("Файл удалён:", filePath);
            res.json({ message: "Файл успешно удален!" });
        });
    });
});

// Обработчик ошибок Multer
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: "Файл слишком большой! Лимит 5MB." });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
