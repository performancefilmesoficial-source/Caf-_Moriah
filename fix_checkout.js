const fs = require('fs');

const frontendPath = 'c:/Antigrafity_PFD/Moriah_PDV/frontend_ecommerce/index.html';
const serverPath = 'c:/Antigrafity_PFD/Moriah_PDV/backend/server.js';

let html = fs.readFileSync(frontendPath, 'utf8');

const checkoutModalRegex = /const CheckoutModal = \(\) => \{[\s\S]+?return \(\s*<div[\s\S]*?<\/div>\s*\);\s*\};/g;

// Aqui construimos o novo Checkout Modal com suporta a Abas (Pix / Cartão)
const newCheckoutModal = `const CheckoutModal = () => {
                if (!isCheckingOut) return null;

                const [step, setStep] = React.useState(1); // 1: Info & Pagamento, 2: PIX Checkout/Loading, 3: Sucesso
                const [customerData, setCustomerData] = React.useState({ name: '', email: '', cpf: '', phone: '', postalCode: '', addressNumber: '' });
                const [paymentMethod, setPaymentMethod] = React.useState('PIX');
                const [cardData, setCardData] = React.useState({ holderName: '', number: '', expiryMonth: '', expiryYear: '', ccv: '' });
                const [pixData, setPixData] = React.useState(null);

                const handlePayment = async (e) => {
                    e.preventDefault();
                    setStep('loading');

                    try {
                        const response = await fetch('/api/checkout', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                customerName: customerData.name,
                                customerEmail: customerData.email,
                                customerCpf: customerData.cpf,
                                customerPhone: customerData.phone,
                                customerCep: customerData.postalCode,
                                customerAddressNumber: customerData.addressNumber,
                                cartItems: cart,
                                totalAmount: finalTotal,
                                billingType: paymentMethod,
                                cardData: paymentMethod === 'CREDIT_CARD' ? cardData : null
                            })
                        });

                        const data = await response.json();

                        if (response.ok && data.success) {
                            if(paymentMethod === 'PIX') {
                                setPixData({ payload: data.pixPayload, encodedImage: data.encodedImage, invoiceUrl: data.invoiceUrl });
                                setStep('pix');
                            } else {
                                setStep(3); // Sucesso direto no Cartão
                            }
                            setCart([]);
                        } else {
                            alert('Erro na transação: ' + (data.error || 'Verifique seus dados digitados.'));
                            setStep(1);
                        }
                    } catch (error) {
                        alert('Erro de conexão durante o pagamento.');
                        setStep(1);
                    }
                };

                return (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-moriah-black/80 backdrop-blur-md overflow-y-auto">
                        <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden mt-20 md:mt-10 mb-10 md:my-auto border border-stone-200">
                            <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50">
                                <div>
                                    <h2 className="font-sans text-2xl font-bold text-moriah-green">Finalizar Compra</h2>
                                    <p className="text-sm text-stone-500">Checkout Transparente Seguro</p>
                                </div>
                                {step !== 3 && step !== 'loading' && (
                                    <button onClick={() => setIsCheckingOut(false)} className="p-2 hover:bg-stone-200 rounded-full transition-colors text-stone-500">
                                        <LucideIcon name="x" className="w-6 h-6" />
                                    </button>
                                )}
                            </div>

                            <div className="p-6 md:p-8">
                                {step === 1 && (
                                    <form onSubmit={handlePayment} className="space-y-6">
                                        <div>
                                            <h3 className="font-bold text-lg text-moriah-brown mb-4 flex items-center gap-2"><LucideIcon name="user" className="w-5 h-5" /> Seus Dados</h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <input required type="text" placeholder="Nome Completo" value={customerData.name} onChange={e => setCustomerData({ ...customerData, name: e.target.value })} className="col-span-1 md:col-span-2 px-4 py-3 bg-white border border-stone-200 rounded-xl outline-none focus:border-moriah-gold text-sm" />
                                                <input required type="email" placeholder="E-mail" value={customerData.email} onChange={e => setCustomerData({ ...customerData, email: e.target.value })} className="px-4 py-3 bg-white border border-stone-200 rounded-xl outline-none focus:border-moriah-gold text-sm" />
                                                <input required type="text" placeholder="CPF/CNPJ numérico" value={customerData.cpf} onChange={e => setCustomerData({ ...customerData, cpf: e.target.value.replace(/\\D/g, '') })} className="px-4 py-3 bg-white border border-stone-200 rounded-xl outline-none focus:border-moriah-gold text-sm" maxLength="14" />
                                                <input required type="text" placeholder="Telefone ex: 11999999999" value={customerData.phone} onChange={e => setCustomerData({ ...customerData, phone: e.target.value.replace(/\\D/g, '') })} className="col-span-1 md:col-span-2 px-4 py-3 bg-white border border-stone-200 rounded-xl outline-none focus:border-moriah-gold text-sm" maxLength="11" />
                                            </div>
                                        </div>

                                        {paymentMethod === 'CREDIT_CARD' && (
                                            <div className="animate-in fade-in zoom-in-95">
                                                <h3 className="font-bold text-lg text-moriah-brown mb-4 flex items-center gap-2 mt-2"><LucideIcon name="map-pin" className="w-5 h-5" /> Endereço de Faturação</h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <input required type="text" placeholder="CEP numérico" value={customerData.postalCode} onChange={e => setCustomerData({ ...customerData, postalCode: e.target.value.replace(/\\D/g, '') })} className="px-4 py-3 bg-white border border-stone-200 rounded-xl outline-none focus:border-moriah-gold text-sm" maxLength="8" />
                                                    <input required type="text" placeholder="Número da Residência" value={customerData.addressNumber} onChange={e => setCustomerData({ ...customerData, addressNumber: e.target.value })} className="px-4 py-3 bg-white border border-stone-200 rounded-xl outline-none focus:border-moriah-gold text-sm" />
                                                </div>
                                            </div>
                                        )}

                                        <div>
                                            <h3 className="font-bold text-lg text-moriah-brown mt-2 mb-4 flex items-center gap-2"><LucideIcon name="credit-card" className="w-5 h-5" /> Condição de Pagamento</h3>
                                            <div className="flex gap-4 mb-4">
                                                <label className={\`flex-1 p-4 border rounded-xl cursor-pointer transition-all flex flex-col items-center justify-center gap-2 \${paymentMethod === 'PIX' ? 'border-moriah-green bg-moriah-green/5 text-moriah-green' : 'border-stone-200 text-stone-500 hover:border-moriah-gold'}\`}>
                                                    <input type="radio" className="hidden" name="paymentMethod" value="PIX" checked={paymentMethod === 'PIX'} onChange={() => setPaymentMethod('PIX')} />
                                                    <LucideIcon name="qr-code" className="w-6 h-6" />
                                                    <span className="font-bold text-sm">Transferência PIX</span>
                                                </label>
                                                <label className={\`flex-1 p-4 border rounded-xl cursor-pointer transition-all flex flex-col items-center justify-center gap-2 \${paymentMethod === 'CREDIT_CARD' ? 'border-moriah-green bg-moriah-green/5 text-moriah-green' : 'border-stone-200 text-stone-500 hover:border-moriah-gold'}\`}>
                                                    <input type="radio" className="hidden" name="paymentMethod" value="CREDIT_CARD" checked={paymentMethod === 'CREDIT_CARD'} onChange={() => setPaymentMethod('CREDIT_CARD')} />
                                                    <LucideIcon name="credit-card" className="w-6 h-6" />
                                                    <span className="font-bold text-sm">Cartão de Crédito</span>
                                                </label>
                                            </div>

                                            {paymentMethod === 'CREDIT_CARD' && (
                                                <div className="p-5 bg-stone-50 rounded-xl border border-stone-200 space-y-4 animate-in fade-in duration-300">
                                                    <input required type="text" placeholder="Nome Impresso no Cartão" value={cardData.holderName} onChange={e => setCardData({ ...cardData, holderName: e.target.value.toUpperCase() })} className="w-full px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none focus:border-moriah-gold text-sm" />
                                                    <input required type="text" placeholder="Número do Cartão" value={cardData.number} onChange={e => setCardData({ ...cardData, number: e.target.value.replace(/\\D/g, '') })} className="w-full px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none focus:border-moriah-gold text-sm" maxLength="16" />
                                                    <div className="flex gap-2">
                                                        <input required type="text" placeholder="Mês (01)" maxLength="2" value={cardData.expiryMonth} onChange={e => setCardData({ ...cardData, expiryMonth: e.target.value.replace(/\\D/g, '') })} className="flex-1 px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none focus:border-moriah-gold text-sm text-center" />
                                                        <span className="flex items-center text-stone-300 font-bold text-xl">/</span>
                                                        <input required type="text" placeholder="Ano (2029)" maxLength="4" value={cardData.expiryYear} onChange={e => setCardData({ ...cardData, expiryYear: e.target.value.replace(/\\D/g, '') })} className="flex-1 px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none focus:border-moriah-gold text-sm text-center" />
                                                        <input required type="text" placeholder="CVV" maxLength="4" value={cardData.ccv} onChange={e => setCardData({ ...cardData, ccv: e.target.value.replace(/\\D/g, '') })} className="w-24 px-4 py-3 bg-white border border-stone-200 rounded-lg outline-none focus:border-moriah-gold text-sm text-center" />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <button type="submit" className="w-full mt-6 bg-moriah-green text-moriah-sand font-bold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 text-lg disabled:opacity-50">
                                            <LucideIcon name="lock" className="w-4 h-4" /> 
                                            Concluir Pagamento (R$ {finalTotal.toFixed(2).replace('.', ',')})
                                        </button>
                                    </form>
                                )}

                                {step === 'pix' && pixData && (
                                    <div className="space-y-6 text-center animate-in fade-in">
                                        <div className="flex flex-col items-center justify-center border-b border-stone-100 pb-6">
                                            <div className="w-16 h-16 bg-moriah-green/10 text-moriah-green rounded-full flex items-center justify-center mb-4"><LucideIcon name="qr-code" className="w-8 h-8" /></div>
                                            <h3 className="font-bold text-2xl text-moriah-brown mb-2">Pague via PIX Asaas</h3>
                                            <p className="text-stone-500 max-w-sm mx-auto">Use o aplicativo do seu banco para ler o QR Code de R$ {finalTotal.toFixed(2).replace('.', ',')} para aprovação.</p>
                                        </div>
                                        <div className="flex justify-center my-6">
                                            <div className="p-4 bg-white border-2 border-stone-100 rounded-3xl shadow-sm inline-block"><img src={\`data:image/jpeg;base64,\${pixData.encodedImage}\`} alt="QR Code PIX" className="w-48 h-48 md:w-56 md:h-56 object-contain" /></div>
                                        </div>
                                        <div className="bg-stone-50 p-4 rounded-xl border border-stone-200">
                                            <p className="text-xs font-bold uppercase text-stone-400 mb-2">Copia e Cola</p>
                                            <div className="flex items-center gap-2">
                                                <input readOnly type="text" value={pixData.payload} className="flex-1 bg-white border border-stone-200 px-3 py-2 rounded-lg text-sm text-stone-600 outline-none" />
                                                <button onClick={() => { navigator.clipboard.writeText(pixData.payload); alert('Código copiado!'); }} className="bg-moriah-gold text-white p-2.5 rounded-lg hover:bg-yellow-500 transition shadow-sm"><LucideIcon name="copy" className="w-4 h-4" /></button>
                                            </div>
                                        </div>
                                        <div className="pt-4 flex flex-col gap-3">
                                            <button onClick={() => { setIsCheckingOut(false); window.location.reload(); }} className="w-full bg-moriah-green text-moriah-sand font-bold py-4 rounded-xl shadow-lg hover:-translate-y-1 hover:shadow-xl transition-all">Já Realizei o Pagamento</button>
                                            <a href={pixData.invoiceUrl} target="_blank" className="text-sm font-semibold text-stone-400 hover:text-moriah-green underline">Abrir Fatura Oficial (Asaas)</a>
                                        </div>
                                    </div>
                                )}

                                {step === 'loading' && (
                                    <div className="text-center py-12 flex flex-col items-center">
                                        <div className="w-16 h-16 border-4 border-moriah-green border-t-moriah-gold rounded-full animate-spin mb-6"></div>
                                        <h3 className="font-bold text-xl text-moriah-brown">Processando Pagamento...</h3>
                                        <p className="text-stone-500 mt-2">Comunicando com a operadora do seu cartão 100% Criptografado.</p>
                                    </div>
                                )}

                                {step === 3 && (
                                    <div className="text-center py-8 flex flex-col items-center animate-in zoom-in-95">
                                        <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6 shadow-sm border-4 border-white outline outline-4 outline-green-50">
                                            <LucideIcon name="check" className="w-10 h-10" />
                                        </div>
                                        <h3 className="font-bold text-3xl text-moriah-brown mb-2">Pagamento Aprovado!</h3>
                                        <p className="text-stone-500 mb-8 max-w-md mx-auto">Seu pedido foi debitado no cartão com sucesso. Um email com os detalhes foi enviado para <strong>{customerData.email}</strong>.</p>
                                        <button onClick={() => { setIsCheckingOut(false); window.location.reload(); }} className="bg-moriah-green text-moriah-sand font-bold px-8 py-4 rounded-xl hover:-translate-y-1 hover:shadow-xl transition-all w-full">Voltar para a Loja</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            };`;

const replacedHtml = html.replace(checkoutModalRegex, newCheckoutModal);
fs.writeFileSync(frontendPath, replacedHtml, 'utf8');


// ==== BACKEND REPLACE ====

let serverHtml = fs.readFileSync(serverPath, 'utf8');

const backendReplaceRegex = /app\.post\(\'\/api\/checkout\', async \(req, res\) => \{[\s\S]+?res\.status\(200\.json\(\{[\s\S]+?\}\);\s*\}\s*catch \(error\) \{[\s\S]+?\]\s*\}\);\s*\}\);/g;
// Regex muito complicada? Vamos procurar pelo padrao que substitui desde o app.post('/api/checkout') até a proxima rota app.post('/api/ecommerce/orders') ou fim.
const backendStartIdx = serverHtml.indexOf("app.post('/api/checkout'");
const nextRouteIdx = serverHtml.indexOf("app.get('/api/orders'", backendStartIdx); // não existe, vejamos
let backendSliceEndIdx = serverHtml.indexOf("// Rota provisoria para receber notificacao", backendStartIdx);
if (backendSliceEndIdx === -1) backendSliceEndIdx = serverHtml.indexOf("});\n\napp.", backendStartIdx) + 3; // +3 to include });

const newBackendCheckout = `app.post('/api/checkout', async (req, res) => {
    const { customerName, customerEmail, customerCpf, customerPhone, customerCep, customerAddressNumber, cartItems, totalAmount, billingType, cardData } = req.body;

    try {
        console.log("Iniciando requisição de checkout remoto - Asaas API...");

        // 1. Criar o Cliente no Asaas
        const customerResponse = await axios.post(\`\${ASAAS_URL}/customers\`, {
            name: customerName,
            email: customerEmail,
            cpfCnpj: customerCpf || '',
            phone: customerPhone || ''
        }, {
            headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' }
        });

        const customerId = customerResponse.data.id;

        // 2. Montar Cobrança Asaas
        const paymentPayload = {
            customer: customerId,
            billingType: billingType || 'PIX', // 'PIX' ou 'CREDIT_CARD'
            dueDate: new Date().toISOString().split('T')[0],
            value: totalAmount,
            description: 'Pedido E-commerce Moriah Café'
        };

        // Regras para Cartão de Crédito exigem Card Info
        if (billingType === 'CREDIT_CARD') {
            paymentPayload.creditCard = {
                holderName: cardData.holderName,
                number: cardData.number,
                expiryMonth: cardData.expiryMonth.padStart(2, '0'),
                expiryYear: cardData.expiryYear,
                ccv: cardData.ccv
            };
            paymentPayload.creditCardHolderInfo = {
                name: customerName,
                email: customerEmail,
                cpfCnpj: customerCpf,
                postalCode: customerCep,
                addressNumber: customerAddressNumber,
                phone: customerPhone
            };
            paymentPayload.remoteIp = req.socket.remoteAddress || '127.0.0.1'; 
        }

        // Criar Pagamento
        const paymentResponse = await axios.post(\`\${ASAAS_URL}/payments\`, paymentPayload, {
            headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' }
        });

        const paymentId = paymentResponse.data.id;
        const invoiceUrl = paymentResponse.data.invoiceUrl;
        let pixPayload = null;
        let encodedImage = null;

        // 3. Obter QR Code do PIX APENAS SE FOR PIX
        if (billingType === 'PIX') {
            const qrCodeResponse = await axios.get(\`\${ASAAS_URL}/payments/\${paymentId}/pixQrCode\`, {
                headers: { 'access_token': ASAAS_API_KEY }
            });
            pixPayload = qrCodeResponse.data.payload;
            encodedImage = qrCodeResponse.data.encodedImage;
        }

        // Enviar Email Tentar
        try {
            const mailOptions = {
                from: '"Moriah Café Especial" <atendimento@moriahcafe.com>',
                to: customerEmail,
                subject: 'Sua compra no Moriah Café! ☕',
                html: \`<p>Olá \${customerName}, sua compra de R$ \${totalAmount} foi registrada no nosso sistema!</p><br><p><a href="\${invoiceUrl}">Acessar Fatura \${billingType}</a></p>\`
            };
            if(process.env.SMTP_USER) transporter.sendMail(mailOptions).catch(() => {});
        } catch (mailErr) {}

        // 4. Salvar venda no Banco de Dados
        (async () => {
            try {
                await dbUtil.run(process.env.DATABASE_URL ? 'START TRANSACTION' : 'BEGIN TRANSACTION');

                // Cartões aprovam mais rápido que PIX, porém deixaremos pendente até webhook para simplificar por enquanto.
                const statusInicial = 'Pendente'; 

                const result = await dbUtil.run(
                    'INSERT INTO sales (total, method, origin, status, customer_phone, payment_id) VALUES (?, ?, ?, ?, ?, ?)',
                    [totalAmount, billingType === 'CREDIT_CARD' ? 'Cartão de Crédito' : 'PIX', 'Online', statusInicial, customerPhone, paymentId]
                );
                const saleId = result[0].insertId;

                for (const item of cartItems) {
                    await dbUtil.run(
                        'INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price) VALUES (?, ?, ?, ?, ?)',
                        [saleId, item.id, item.name, item.quantity, item.price]
                    );
                    await dbUtil.run(
                        'UPDATE products SET stock = stock - ? WHERE id = ?',
                        [item.quantity, item.id]
                    );
                }

                await dbUtil.run('COMMIT');
            } catch (dbErr) {
                await dbUtil.run('ROLLBACK');
                console.error("Erro ao salvar no banco:", dbErr);
            }
        })();

        res.status(200).json({
            success: true,
            sale_id: paymentId,
            pixPayload: pixPayload,
            encodedImage: encodedImage,
            invoiceUrl: invoiceUrl
        });

    } catch (error) {
        console.error('Erro no checkout / Asaas:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: error.response?.data?.errors?.[0]?.description || 'Erro de integração ao capturar cartão.' });
    }
}`;

const prefix = serverHtml.substring(0, backendStartIdx);
const suffix = serverHtml.substring(backendSliceEndIdx);

fs.writeFileSync(serverPath, prefix + newBackendCheckout + suffix, 'utf8');
console.log('Update Success!');
