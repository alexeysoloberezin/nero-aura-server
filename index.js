const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const axios = require('axios')
const nodemailer = require("nodemailer");
const app = express();
const { v4: uuidv4 } = require("uuid");
const uploadRoute = require("./upload");

dotenv.config()

const PORT = 5000;
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

const allowedOrigins = [
  'https://www.neuro-aura.com',
  'https://neroaura-git-development-alexeysoloberezins-projects.vercel.app'
]
// Middleware
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('⛔️ Not allowed by CORS: ' + origin))
    }
  },
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true
}))
// app.use(cors({
//   origin: '*',
//   methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
//   credentials: true
// }))
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
  try{
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
  }catch (err){
    res.status(500).json({ success: false, error: err.message });
  }
});

const ids = {
  '1': 'free_lessons',
  '2': 'free_lessons',
  '3': 'photosession',
  '4': 'photosession',
}

app.post('/get-lessons', async (req, res) => {
  const { courseId, lessonId } = req.body

  try{
    const { data, error } = await supabase
    .from(ids[courseId])
    .select('id, title, title_en')
    .order('id')

    if (error) {
      return res.status(500).json({ error: error.message }); // Явно выбрасываем ошибку
    }

    return res.json(data);
  }catch (err){
    res.status(500).json({ success: false, error: err.message });
  }
})

app.post('/get-lesson', async (req, res) => {
  const { token, courseId, lessonId } = req.body


  if (!token || !courseId || !lessonId) return res.json({ message: 'Ошибка' })

  try{
    const { data: user, error } = await supabase.auth.getUser(token)

    // обработка ошибка
    const { data: existingUser, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', user.user.email)
      .single();
  
  
    if (!existingUser.available_courses.includes(courseId)) {
      return res.status(400).json({ message: 'Курс не куплен' })
    }
  
    const { data, status } = await supabase
      .from(ids[courseId])
      .select('*')
      .eq('id', lessonId)
      .single();
  
    if (error) {
      return res.status(500).json({ error: error.message }); // Явно выбрасываем ошибку
    }
  
    return res.json(data);
  }catch (err){
    res.status(500).json({ success: false, error: err.message });
  }
})

app.post("/reset-password", async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(400).json({ success: false, error: "Email is required" });
  }

  try{
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
  }catch (err){
    res.status(500).json({ success: false, error: err.message });
  }
})

app.post("/confirm-email", async (req, res) => {
  const { code, to } = req.body

  if (!code || !to) {
    return res.status(500).json({ success: false, error: 'Email or Code is required' });
  }

  try {
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
  } catch (error) {
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
})

app.post("/send-email", async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
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
  }catch (err){
    res.status(500).json({ success: false, error: err.message });
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

app.post('/notifications-count', async (req, res) => {
  try{
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { data: homeworks, error: homeworksError } = await supabase
      .from("homeworks")
      .select("id, lesson_id, messages")
      .eq("user_id", user_id)
      .eq('readLastMessage', false)

    if (homeworksError) {
      console.error(homeworksError);
      return res.status(500).json({ error: 'Ошибка при получении homeworks' });
    }

    return res.json({ needAnswer: homeworks.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/notifications', async (req, res) => {
  try{
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
  
    const { data: homeworks, error: homeworksError } = await supabase
      .from("homeworks")
      .select("id, lesson_id, messages")
      .eq("user_id", user_id)
      .eq('readLastMessage', false)
  
    if (homeworksError) {
      console.error(homeworksError);
      return res.status(500).json({ error: 'Ошибка при получении homeworks' });
    }
  
    return res.json(homeworks);
  }catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/send-anketa', async (req, res) => {
  try{
    const { client_id } = req.body;

    fetch(`https://chatter.salebot.pro/api/e580ab8279f420cfa577732738682599/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: client_id,
        message: 'Спасибо, за заполнение анкеты. Напишите боту, код на продолжение: 891'
      })
    })

    return res.json({ success: true, message: 'Анкета отправлена' });
  }catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
})

app.post('/create-invoice', async (req, res) => {
  try {
    const { email, currency, paymentMethod, tariff, alreadyCreated } = req.body;

    // TODO
    const { data: existingUser, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ message: 'Ошибка при проверке профиля' })
    }

    if (existingUser && existingUser.available_courses.includes(tariff.id)) {
      return res
        .status(400)
        .json({ message: 'Вы уже приобрели этот курс' })
    }

    // return res.json({ existingUser, tariff, hasCourse: 'no' })
    // ✅ Если аккаунта нет, создаём инвойс
    const data = {
      email,
      offerId: tariff.tarrif_id,
      buyerLanguage: 'EN',
      currency,
      paymentMethod
    };

    console.log('create-invoce for tariff_id:', tariff.tariff_id)

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

const listTarrifsByAmount = {
  "10": {
    tariff_id: "9e6ac7ff-f092-4521-8eaf-0f35cd53e8ae",
    course_id: "1"
  },
  "15": {
    tariff_id: "2fbfb5ef-a4a8-4d8e-af2e-98fe5a4670e9",
    course_id: "2"
  },
  "19": {
    tariff_id: "359a02c8-1ea3-4118-ac51-0b7d5d6e0463",
    course_id: "3"
  },
  "39": {
    tariff_id: "f45d2bf2-19f0-472b-ac81-5567d53322e8",
    course_id: "4"
  }
}

app.post('/lava-webhook', apiKeyMiddleware, async (req, res) => {
  try {
    const webhookData = req.body;

    console.log('webhookData', webhookData)

    if (webhookData.status === 'completed') {
      const buyerEmail = webhookData.buyer.email;

      // Проверяем, существует ли пользователь
      const { data: existingUser, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', buyerEmail)
        .single();

      const amount = webhookData.amount + ''
      const tariffData = listTarrifsByAmount?.[amount]

      if (!tariffData) {
        console.error('Тариф не найден в courses_tariffs по amount:', tariffData)
        return res.status(400).json({ error: 'Тариф не найден' })
      }

      let courseToAdd = tariffData.course_id

      if (existingUser) {
        const courses = existingUser.available_courses || []

        if (!courses.includes(courseToAdd)) {
          courses.push(courseToAdd)
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ available_courses: courses })
            .eq('email', buyerEmail)

          if (updateError) {
            console.error('Ошибка обновления available_courses:', updateError)
            return res.status(500).json({ message: 'Не удалось обновить курсы' })
          }
        }
      } else {
        const accountCreationResult = await createAccountAfterPayment(buyerEmail, courseToAdd);
        if (!accountCreationResult.success) {
          return res.status(500).json({ error: accountCreationResult.error });
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


async function createAccountAfterPayment(to, courseToAdd) {
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
    .update({ available_courses: [courseToAdd] })
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
      subject: 'Ваш доступ к курсу –  от Neuro.Aura',
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
            max-width: 1138px;
            background: #ffffff;
            margin: 20px auto;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            text-align: center;
        }
        h3 {
            color: #333;
            font-size: 18px;
            font-weight: 600;
        }
        h4{
          font-size: 18px;
          font-weight: 600;
        }
        .code-box {
            font-size: 22px;
            font-weight: bold;
            background: #f0f8ff;
            border: 2px dashed #007bff;
            color: #007bff;
            padding: 10px 20px;
            display: inline-block;
            margin: 5px 0;
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
        .pass{
          font-size: 18px;
          font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <h3>
            Благодарим вас за приобретение доступа к нашему курсу по нейросетям на платформе NEURO AURA.<br/> Мы рады приветствовать вас в сообществе, стремящемся к освоению передовых технологий искусственного интеллекта.
        </h3>
        <h4>
            Для входа в ваш личный кабинет используйте следующие данные
        </h4>
        <div class="pass">Временный пароль (скопируйте):</div>
        <div class="code-box">${password}</div>
        
        <br/>
        <a href="https://neuro-aura.com/ru/app/thanks?email=${to}" class="button">Войти на сайт</a>
        <p>
        Важно: Для обеспечения безопасности вашего аккаунта настоятельно рекомендуем сменить временный пароль при первом входе.
        </p>
        <div>
          Если у вас возникнут вопросы или нужна помощь, мы всегда на связи:<br/>
          📩 Telegram: <a href="https://t.me/neuroauro">@neuroauro</a><br/>
          📷 Instagram: <a href="https://www.instagram.com/neuro.auro/">@neuro.auro</a> 
        </div>


        <p>Желаем успехов в обучении и вдохновения в применении полученных знаний!</p>
        <p class="footer">
            С уважением,
            Команда NEURO AURA
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

app.post('/check-email', async (req, res) => {
  const code = '1231231231231'
  try {
    const info = await transporter.sendMail({
      from: `"Neuro Aura" <${process.env.SMTP_USER}>`,
      to: 'alexeysoloberezinsolo@gmail.com',
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
            max-width: 1138px;
            background: #ffffff;
            margin: 20px auto;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            text-align: center;
        }
        h3 {
            color: #333;
            font-size: 18px;
            font-weight: 600;
        }
        h4{
          font-size: 18px;
          font-weight: 600;
        }
        .code-box {
            font-size: 22px;
            font-weight: bold;
            background: #f0f8ff;
            border: 2px dashed #007bff;
            color: #007bff;
            padding: 10px 20px;
            display: inline-block;
            margin: 5px 0;
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
        .pass{
          font-size: 18px;
          font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="email-container">
        <h3>
            Благодарим вас за приобретение доступа к нашему курсу по нейросетям на платформе NEURO AURA.<br/> Мы рады приветствовать вас в сообществе, стремящемся к освоению передовых технологий искусственного интеллекта.
        </h3>
        <h4>
            Для входа в ваш личный кабинет используйте следующие данные
        </h4>
        <div class="pass">Временный пароль (скопируйте):</div>
        <div class="code-box">${code}</div>
        
        <br/>
        <a href="https://neuro-aura.com/ru/app/thanks" class="button">Войти на сайт</a>
        <p>
        Важно: Для обеспечения безопасности вашего аккаунта настоятельно рекомендуем сменить временный пароль при первом входе.
        </p>
        <div>
          Если у вас возникнут вопросы или нужна помощь, мы всегда на связи:<br/>
          📩 Telegram: @neuroauro (https://t.me/neuroauro)<br/>
          📷 Instagram: @neuro.auro (https://www.instagram.com/neuro.auro/)
        </div>


        <p>Желаем успехов в обучении и вдохновения в применении полученных знаний!</p>
        <p class="footer">
            С уважением,
            Команда NEURO AURA
        </p>
    </div>

</body>
</html>
`,
    });

    res.status(200).json({ success: true, message: 'Webhook received' });
  } catch (emailError) {
    console.error('Ошибка при отправке email:', emailError);
    res.status(200).json({ success: true, message: 'Webhook received' });
  }
})

app.post("/confirm-email", async (req, res) => {
  const { code, to } = req.body

  if (!code || !to) {
    return res.status(500).json({ success: false, error: 'Email or Code is required' });
  }

  try {
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
  } catch (error) {
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
})

app.post("/send-email", async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(500).json({ success: false, error: 'Email is required' });
  }

  function generateCode() {
    return Math.floor(1000 + Math.random() * 9000);
  }

  const code = generateCode()

  try{
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
  }catch (err){
    res.status(500).json({ success: false, error: err.message });
  }
})

app.post('/lava-webhook-recurrent', apiKeyMiddleware, async (req, res) => {
  try {
    const webhookData = req.body; // Данные от Lava.top

    if (webhookData.status === 'completed') {
      const buyer = webhookData.buyer.email

      const { data, error } = await supabase
        .from('profiles')
        .update({ hasSub: true })
        .eq('email', buyer)
        .select()

      if (error) return res.status(500).json({ error: error.message });;
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


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('API_KEY:', API_KEY)
});
