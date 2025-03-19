
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const axios = require('axios')
const nodemailer = require("nodemailer");
const app = express();
const { v4: uuidv4 } = require("uuid");
const uploadRoute = require("./upload");
const bcrypt = require('bcryptjs');

dotenv.config()

const PORT =  5000;
const API_KEY = process.env.API_KEY
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET

// Подключение к Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Полный доступ
);

const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  const apiKeySecond = req.headers["X-Api-Key"]


  const key = apiKey || apiKeySecond

  if (!key || key !== WEBHOOK_SECRET) {
      return res.status(403).json({ error: "Invalid API Key" });
  }
  next();
};


// Middleware
app.use(cors({
  origin: 'https://www.neuro-aura.com',  // Разрешённый домен
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true // Если нужно передавать cookies
}));
// app.use(cors('*'));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(uploadRoute);
app.use("/uploads", express.static("uploads"));

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
      html: `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Подтверждение регистрации</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
        }
        .email-container {
            max-width: 600px;
            background: #ffffff;
            margin: 20px auto;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            text-align: center;
        }
        h3 {
            color: #333;
            font-size: 22px;
        }
        .code-box {
            font-size: 22px;
            font-weight: bold;
            background: #f0f8ff;
            border: 2px dashed #007bff;
            color: #007bff;
            padding: 10px 20px;
            display: inline-block;
            margin: 15px 0;
            user-select: all; /* Позволяет легко копировать код */
            border-radius: 5px;
        }
        .button {
            display: inline-block;
            background: #00bcbc;
            color: white !important;
            text-decoration: none;
            font-size: 18px;
            padding: 12px 24px;
            border-radius: 5px;
            font-weight: bold;
            margin-top: 20px;
        }
        .button:hover {
            background: #009999;
        }
        .footer {
            margin-top: 20px;
            font-size: 14px;
            color: #666;
        }
    </style>
</head>
<body>

    <div class="email-container">
        <h3>Спасибо за оплату.</h3>
        <p>Ваши данные для авторизации в приложении:</p>

        <div class="code-box">${code}</div>

        <p>Или нажмите кнопку ниже для входа в аккаунт:</p>

        <a href="https://neuro-aura.com/ru/app/thanks?email=${to}" class="button">Войти на сайт</a>

        <p class="footer">
            Если вы не оплачивпли курс на сайте <a href="https://neuro-aura.com">neuro-aura.com</a>, просто проигнорируйте это сообщение.<br>
            С уважением,<br>Команда поддержки
        </p>
    </div>

</body>
</html>
` // Текст письма
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
  const ss = 'cbd17b2c-881f-4668-84b2-25612bfbf554';
  const good = '9e6ac7ff-f092-4521-8eaf-0f35cd53e8ae';

  try {
    const { email, currency, paymentMethod, tariff } = req.body;

    const { data: existingUser, error: fetchError } = await supabase
      .from('profiles')
      .select('email')
      .eq('email', email)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    // ✅ Если аккаунт уже существует — возвращаем ошибку
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Аккаунт с такой почтой уже существует'
      });
    }

    let id = '2fbfb5ef-a4a8-4d8e-af2e-98fe5a4670e9'

    if(tariff === 10){
      id = '9e6ac7ff-f092-4521-8eaf-0f35cd53e8ae'
    }

    // ✅ Если аккаунта нет, создаём инвойс
    const data = {
      email,
      offerId: id,
      buyerLanguage: 'EN',
      currency,
      paymentMethod
    };

    const response = await axios.post(
      'https://gate.lava.top/api/v2/invoice',
      data,
      {
        headers: {
          accept: 'application/json',
          'X-Api-Key': process.env.API_KEY, // Ключ из .env
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



app.post('/lava-webhook', apiKeyMiddleware,  async (req, res) => {
  try {
    const webhookData = req.body; 

    if (webhookData.status === 'completed') {
      const buyerEmail = webhookData.buyer.email;

      // Проверяем, существует ли пользователь
      const { data: existingUser, error: fetchError } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', buyerEmail)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') { // Ошибка 'PGRST116' означает, что запись не найдена
        throw fetchError;
      }

      if (existingUser) {
        // ✅ Обновляем подписку, если пользователь уже существует
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ hasSub: true })
          .eq('email', buyerEmail);

        if (updateError) throw updateError;
      } else {
        // ✅ Создаем аккаунт, если его еще нет
        const accountCreationResult = await createAccountAfterPayment(buyerEmail);
        if (!accountCreationResult.success) {
          throw new Error(accountCreationResult.error);
        }
      }

    } else if (webhookData.status === 'failed') {
      console.log(`❌ Платеж ${webhookData.contractId} не прошел.`);
    }

    res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (error) {
    console.error('Ошибка обработки вебхука:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

async function createAccountAfterPayment(to) {
  const password = uuidv4().slice(0, 10); 

  // 🔥 Создаём пользователя в Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: to,
    password: password
  });

  if (authError) {
    console.error('Ошибка при создании аккаунта в Auth:', authError.message);
    return { success: false, error: 'Ошибка при создании аккаунта в Auth' };
  }

  // Получаем user_id из Auth
  const userId = authData.user.id;

  // ✅ Создаём запись в таблице profiles
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ hasSub: true })
    .eq('email', to);

  if (updateError) {
    console.error('Ошибка при создании профиля в profiles:', updateError.message);
    return { success: false, error: 'Ошибка при создании профиля' };
  }

  // 📧 Отправляем email с паролем
  try {
    const info = await transporter.sendMail({
      from: `"Neuro Aura" <${process.env.SMTP_USER}>`,
      to,
      subject: 'Neuro Aura: Ваш аккаунт создан',
      html: `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Подтверждение регистрации</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
        }
        .email-container {
            max-width: 600px;
            background: #ffffff;
            margin: 20px auto;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            text-align: center;
        }
        h3 {
            color: #333;
        }
        .code-box {
            font-size: 22px;
            font-weight: bold;
            background: #f0f8ff;
            border: 2px dashed #007bff;
            color: #007bff;
            padding: 10px 20px;
            display: inline-block;
            margin: 15px 0;
            user-select: all; /* Позволяет легко копировать код */
            border-radius: 5px;
        }
        .button {
            display: inline-block;
            background: #00bcbc;
            color: white !important;
            text-decoration: none;
            font-size: 18px;
            padding: 12px 24px;
            border-radius: 5px;
            font-weight: bold;
            margin-top: 20px;
        }
        .button:hover {
            background: #009999;
        }
        .footer {
            margin-top: 20px;
            font-size: 14px;
            color: #666;
        }
    </style>
</head>
<body>

    <div class="email-container">
        <h3>Спасибо за оплату, вам создан аккаунт</h3>
        <p>Ваш пароль для авторизации:</p>

        <div class="code-box">${code}</div>

        <p>Нажмите кнопку ниже для перехода на страницу авторизации:</p>

        <a href="https://neuro-aura.com/app/thanks?email=${to}" class="button">Войти в приложение</a>

        <p class="footer">
            Если вы не оплачитвали курс на сайте <a href="https://neuro-aura.com">neuro-aura.com</a>, просто проигнорируйте это сообщение.<br>
            С уважением,<br>Команда поддержки
        </p>
    </div>
</body>
</html>
`,
    });

    return { success: true, message: 'Аккаунт создан и email отправлен', authData };
  } catch (emailError) {
    console.error('Ошибка при отправке email:', emailError);
    return { success: false, error: 'Ошибка при отправке email' };
  }
}

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
})

app.post('/lava-webhook-recurrent', apiKeyMiddleware, async  (req, res) => {
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
