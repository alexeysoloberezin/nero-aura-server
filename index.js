
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const dotenv = require('dotenv');
const axios = require('axios')

const app = express();
const PORT =  5000;
const API_KEY = process.env.API_KEY

dotenv.config();
// Подключение к Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Полный доступ
);

// Middleware
app.use(cors({
  origin: 'https://www.neuro-aura.com',  // Разрешённый домен
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true // Если нужно передавать cookies
}));
app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Лимит: 10MB
});
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // Берём токен из заголовка

  if (!token) {
    return res.status(401).json({ error: "Нет токена" });
  }

  

  // Проверяем токен через Supabase
  const { data: user, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: "Неверный токен" });
  }

  req.user = user; // Сохраняем данные пользователя в запрос
  next();
};
// 📌 Получить всех пользователей
app.get('/', (req, res) => {
  res.send('ALL работает!');
});

app.post('/create-invoice', async (req, res) => {
  try {
    const { email, currency, paymentMethod } = req.body
    const { offerId, buyerLanguage } = {
      offerId: 'cbd17b2c-881f-4668-84b2-25612bfbf554',
      buyerLanguage: 'EN'
    }

    let data = { email, offerId, currency, buyerLanguage, paymentMethod }

    const response = await axios.post(
      'https://gate.lava.top/api/v2/invoice',
      data,
      {
        headers: {
          accept: 'application/json',
          'X-Api-Key': API_KEY, // Используем ключ из .env
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ success: true, data: response.data });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

app.post('/lava-webhook', async  (req, res) => {
  try {
    const webhookData = req.body; // Данные от Lava.top

    if (webhookData.status === 'completed') {
      const buyer = webhookData.buyer.email

      const { data, error } = await supabase
        .from('profiles')
        .update({ hasSub: true })
        .eq('email', buyer)
        .select()

      if (error) throw error;
    } else if (webhookData.status === 'failed') {
      console.log(`❌ Платеж ${webhookData.contractId} не прошел.`);
    }
    res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('Ошибка обработки вебхука:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/get-products', async (req, res) => {
  console.log('get prods')
  try {
    const response = await axios.get(
      'https://gate.lava.top/api/v2/products',
      {
        headers: {
          accept: 'application/json',
          'X-Api-Key': API_KEY, // Используем ключ из .env
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ success: true, data: response.data });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});


// Запуск сервера
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
