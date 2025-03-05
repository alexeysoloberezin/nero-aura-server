
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const axios = require('axios')
const nodemailer = require("nodemailer");
const app = express();
const { v4: uuidv4 } = require("uuid");

dotenv.config();

const PORT =  5000;
const API_KEY = process.env.API_KEY

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
// app.use(cors('*'));
app.use(express.json());

const transporter = nodemailer.createTransport({
  host: "smtp.mail.ru",
  port: 465, // Или 587
  secure: true, // true для 465, false для 587
  auth: {
    user: process.env.SMTP_USER, // Email от Mail.ru
    pass: process.env.SMTP_PASS  // Пароль приложения
  }
});

app.post("/reset-password-action", async (req, res) => {
  const { to, token, password, password_repeat } = req.body;

  // 📌 1. Проверяем, переданы ли все параметры
  if (!to || !token || !password || !password_repeat) {
      return res.status(400).json({ success: false, error: "Все поля обязательны!" });
  }

  // 📌 2. Проверяем, совпадают ли пароли
  if (password !== password_repeat) {
      return res.status(400).json({ success: false, error: "Пароли не совпадают!" });
  }

  // 📌 3. Ищем запись с email + token в resetPassword
  const { data, error } = await supabase
      .from("resetPassword")
      .select("*")
      .eq("email", to)
      .eq("token", token)
      .single();

  if (error || !data) {
      return res.status(400).json({ success: false, error: "Неверный токен или email!" });
  }

  // 📌 4. Получаем `id` пользователя из auth.users
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users?.users.find(u => u.email === to);

  if (!user) {
      return res.status(400).json({ success: false, error: "Пользователь не найден!" });
  }

  // 📌 5. Обновляем пароль через Supabase Auth
  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: password
  });

  if (updateError) {
      return res.status(500).json({ success: false, error: "Ошибка при обновлении пароля!" });
  }

  // 📌 6. Удаляем использованный токен
  await supabase.from("resetPassword").delete().eq("email", to);

  return res.status(200).json({ success: true, message: "Пароль успешно изменён!" });
});

app.post("/reset-password", async (req, res) => {
  const { to } = req.body;

  if (!to) {
      return res.status(400).json({ success: false, error: "Email is required" });
  }

  const token = uuidv4(); // 📌 Генерируем уникальный токен
  const resetLink = `https://www.neuro-aura.com/app/resetPassword?email=${to}&token=${token}`;

  // 📌 1. Удаляем старые токены, если они есть
  await supabase.from("resetPassword").delete().eq("email", to);

  // 📌 2. Сохраняем новый токен в Supabase
  const { error: insertError } = await supabase
      .from("resetPassword")
      .insert([{ email: to, token }]);

  if (insertError) {
      console.error("Ошибка при сохранении токена:", insertError.message);
      return res.status(500).json({ success: false, error: "Ошибка при создании токена" });
  }

  try {
      // 📌 3. Отправляем email со ссылкой
      const info = await transporter.sendMail({
          from: `"Neuro Aura" <${process.env.SMTP_USER}>`,
          to,
          subject: "Neuro Aura: Сброс пароля",
          html: `
              <h3>Сброс пароля</h3>
              <p>Перейдите по ссылке для сброса пароля:</p>
              <h2 style="color: #007bff;">
                  <a href="${resetLink}"><strong>Сбросить пароль</strong></a>
              </h2>
              <p>Если вы не запрашивали сброс пароля на сайте neuro-aura.com, просто проигнорируйте это сообщение.</p>
              <p>С уважением,<br>Команда поддержки</p>
          `
      });

      return res.json({ success: true, message: "Email sent!", info });
  } catch (error) {
      console.error("Ошибка при отправке email:", error);
      return res.status(500).json({ success: false, error: error.message });
  }
})

app.post("/confirm-email", async (req, res) => {
  const {code, to} = req.body

  if(!code || !to){
    return res.status(500).json({ success: false, error: 'Email or Code is required' });
  }

  try{
    const { data, error } = await supabase
      .from("confirmEmail")
      .select("*")
      .eq("email", to)
      .order("created_at", { ascending: false }) // Сортируем от новой к старой
      .limit(1)
      .single()


    if (error || !data) {
      return res.status(400).json({ message: "Code not correct or Email not found" });
    }

    if (data.code === code) {
      const { error: deleteError } = await supabase
        .from("confirmEmail")
        .delete()
        .eq("email", to);

       return res.status(200).json({ message: "Email confirmed!" });
    } else {
      return res.status(400).json({ message: "Not correct code" });
    }
  }catch(error){
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
})

app.post("/send-email", async (req, res) => {
  const { to } = req.body;

  if(!to){
    return res.status(500).json({ success: false, error: 'Email is required' });
  }

  function generateCode() {
    return Math.floor(1000 + Math.random() * 9000);
  }

  const code = generateCode()
  
  const { error: deleteError } = await supabase
        .from("confirmEmail")
        .delete()
        .eq("email", to);

  if (deleteError) {
      console.error("Ошибка при удалении старых записей:", deleteError.message);
      return res.status(500).json({ success: false, error: "Ошибка при удалении старых кодов" });
  }

  const { data, error } = await supabase
    .from("confirmEmail")
    .insert([
        {
            email: to,
            code: code
        }
    ]);

  if (error) {
      console.error("Ошибка при добавлении записи:", error.message);
      res.status(500).json({ success: false, error: 'Ошибка при создания кода' });
  } 

  try {
    const info = await transporter.sendMail({
      from: `"Neuro Aura" <${process.env.SMTP_USER}>`, // От кого
      to, // Кому
      subject: "Nero Aura: код", // Тема письма
      html: `<h3>Спасибо за регистрацию.</h3>
<p>Введите следующий код на сайте для подтверждения:</p>
<h2 style="color: #007bff;">🔢 Ваш код: <strong>${code}</strong></h2>
<p>Если вы не запрашивали регистрацию на сайте neuro-aura.com , просто проигнорируйте это сообщение.</p>
<p>С уважением,<br>Команда поддержки</p>` // Текст письма
    });

    return res.json({ success: true, message: "Email sent!", info });
  } catch (error) {
    console.error("Ошибка при отправке email:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
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
  console.log('API_KEY:', API_KEY)
});
